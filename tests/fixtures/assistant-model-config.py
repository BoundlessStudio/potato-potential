import contextlib
import io
import json
import os
import sys
import tempfile
import types
from pathlib import Path

import yaml

source = sys.stdin.read()
compile(source, "assistant-model.py", "exec")
if os.name == "nt":
    # Exercise real config and hook writes on Windows. Production uses Linux's
    # advisory locks and fd permissions rather than these compatibility shims.
    sys.modules["fcntl"] = types.SimpleNamespace(flock=lambda *args: None, LOCK_EX=2)
    os.fchmod = lambda *args: None

with tempfile.TemporaryDirectory(prefix="assistant-model-qa-") as directory:
    sandbox = Path(directory)
    Path.home = classmethod(lambda cls: sandbox)
    config_path = sandbox / ".hermes" / "config.yaml"
    config_path.parent.mkdir()
    hook_path = sandbox / ".agent37" / "hooks" / "post-restart.sh"
    hook_path.parent.mkdir(parents=True)
    original_hook = "#!/bin/bash\n# boundless-inkbox-sdk\necho install-inkbox\n"
    hook_path.write_text(original_hook)
    original = {
        "model": {"default": "default", "provider": "custom:Agent37", "context_length": 128000},
        "custom_providers": [{"name": "Agent37", "api_key": "private-token", "base_url": "https://example.test/v1"}],
        "platforms": {"inkbox": {"enabled": True}},
        "mcp_servers": {"composio": {"headers": {"Authorization": "Bearer private-token"}}},
    }
    config_path.write_text(yaml.safe_dump(original))
    choice = {"model": "openai/gpt-5.2", "provider": "custom:agent37"}
    unset = object()

    def run(selection=unset):
        # setModel installs this file before execution. Clearing must delete it.
        script_path = sandbox / ".boundless" / "assistant-model.py"
        script_path.parent.mkdir(exist_ok=True)
        script_path.write_text(source)
        sys.argv = [str(script_path)] + ([json.dumps(selection)] if selection is not unset else [])
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(source, str(script_path), "exec"), {})

    run(choice)
    run(choice)
    actual = yaml.safe_load(config_path.read_text())
    assert actual["model"]["default"] == choice["model"]
    assert actual["model"]["context_length"] == 128000
    for field in ["custom_providers", "platforms", "mcp_servers"]:
        assert actual[field] == original[field], field
    assert hook_path.read_text().count("# BEGIN boundless-assistant-model") == 1
    assert "echo install-inkbox" in hook_path.read_text()
    # Simulate startup config injection and managed-credential rotation.
    actual["model"]["default"] = "default"
    actual["custom_providers"][0]["api_key"] = "rotated-token"
    actual["model"]["context_length"] = 256000
    config_path.write_text(yaml.safe_dump(actual))
    run()
    actual = yaml.safe_load(config_path.read_text())
    assert actual["model"]["default"] == choice["model"]
    assert actual["custom_providers"][0]["api_key"] == "rotated-token"
    run(None)
    assert hook_path.read_text() == original_hook
    restored = yaml.safe_load(config_path.read_text())
    assert restored["model"] == {"default": "default", "provider": "custom:Agent37", "context_length": 256000}
    assert restored["custom_providers"][0]["api_key"] == "rotated-token"
    for path in ["assistant-model.json", "assistant-model-original.yaml", "assistant-model.py"]:
        assert not (sandbox / ".boundless" / path).exists(), path
    # A delayed hook after clearing exits without reapplying the old choice.
    try:
        run()
    except SystemExit as error:
        assert error.code == 0
    config_path.write_text("model: [invalid")
    try:
        run(choice)
    except yaml.YAMLError:
        pass
    else:
        raise AssertionError("Malformed config was accepted")
    assert config_path.read_text() == "model: [invalid"
    # Restore legacy key names, provider casing, inline credentials and scalar
    # config rather than retaining an app-created model.default field.
    for native in [
        {"model": "legacy-native", "provider": "CustomVendor", "base_url": "https://own.test/v1", "api_key": "own-private", "api_mode": "chat_completions"},
        {"default": "native", "provider": "custom:Agent37", "base_url": "https://example.test/v1", "api_key": "old-managed-token"},
        "native-scalar-model",
    ]:
        config_path.write_text(yaml.safe_dump({"model": native, "unrelated": {"keep": True}, "custom_providers": original["custom_providers"]}))
        run(choice)
        run(None)
        restored = yaml.safe_load(config_path.read_text())
        expected = dict(native) if isinstance(native, dict) else native
        if isinstance(expected, dict) and expected.get("provider") == "custom:Agent37":
            expected["api_key"] = "private-token"
        assert restored["model"] == expected, restored
        assert restored["unrelated"] == {"keep": True}

print("Assistant model config QA passed")
