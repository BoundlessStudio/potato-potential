// Runs inside the Hermes venv. Only model routing changes; credentials and the
// rest of config.yaml stay on the computer and never pass through our API.
export const assistantModelScript = String.raw`import fcntl, json, os, re, stat, sys, tempfile
from pathlib import Path
import yaml

root = Path.home()
workspace = root / ".boundless"
workspace.mkdir(parents=True, exist_ok=True)
selection_path = workspace / "assistant-model.json"
original_path = workspace / "assistant-model-original.yaml"
script_path = workspace / "assistant-model.py"
config_path = root / ".hermes" / "config.yaml"
hook_path = root / ".agent37" / "hooks" / "post-restart.sh"

def atomic_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".assistant-model-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), mode)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def provider_key(value):
    return str(value or "").strip().lower().replace(" ", "-")

with (workspace / "assistant-model.lock").open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    if len(sys.argv) == 1 and not selection_path.exists():
        sys.exit(0)
    selection = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.loads(selection_path.read_text())
    if selection is not None and (set(selection) != {"model", "provider"} or not all(isinstance(v, str) and v.strip() for v in selection.values())):
        raise ValueError("Invalid assistant model")
    original = config_path.read_text(encoding="utf-8")
    config = yaml.safe_load(original)
    if not isinstance(config, dict):
        raise ValueError("Invalid Hermes configuration")
    routing_keys = ("default", "model", "provider", "base_url", "api_key", "api", "api_mode")
    if selection is not None:
        if not original_path.exists():
            atomic_write(original_path, yaml.safe_dump({"present": "model" in config, "model": config.get("model")}, sort_keys=False))
        previous = config.get("model")
        model = dict(previous) if isinstance(previous, dict) else {}
        if provider_key(model.get("provider")) != provider_key(selection["provider"]):
            for key in ("base_url", "api_key", "api", "api_mode"):
                model.pop(key, None)
        model["default"] = selection["model"]
        model["provider"] = selection["provider"]
        if "model" in model:
            model["model"] = selection["model"]
        config["model"] = model
    elif original_path.exists():
        snapshot = yaml.safe_load(original_path.read_text(encoding="utf-8"))
        previous = snapshot["model"]
        if isinstance(previous, dict):
            model = dict(config.get("model")) if isinstance(config.get("model"), dict) else {}
            # Preserve freshly rotated Agent37 credentials rather than reviving
            # a token captured before a restart. Other settings stay untouched.
            if provider_key(previous.get("provider")) == "custom:agent37":
                for provider in config.get("custom_providers", []):
                    if isinstance(provider, dict) and provider_key(provider.get("name")) == "agent37":
                        for key in ("api_key", "base_url"):
                            if key in previous and key in provider:
                                previous[key] = provider[key]
            for key in routing_keys:
                if key in previous:
                    model[key] = previous[key]
                else:
                    model.pop(key, None)
            config["model"] = model
        elif snapshot["present"]:
            config["model"] = previous
        else:
            config.pop("model", None)
    if config_path.read_text(encoding="utf-8") != original:
        raise RuntimeError("Hermes configuration changed; retry")
    atomic_write(config_path, yaml.safe_dump(config, sort_keys=False), stat.S_IMODE(config_path.stat().st_mode))
    hook = hook_path.read_text(encoding="utf-8") if hook_path.exists() else "#!/bin/bash\n"
    hook = re.sub(r"(?m)^# BEGIN boundless-assistant-model\n.*?^# END boundless-assistant-model\n?", "", hook, flags=re.S)
    if selection is not None:
        atomic_write(selection_path, json.dumps(selection))
        hook = hook.rstrip() + '\n# BEGIN boundless-assistant-model\n/usr/local/lib/hermes/hermes-agent/venv/bin/python "$HOME/.boundless/assistant-model.py"\n# END boundless-assistant-model\n'
    else:
        selection_path.unlink(missing_ok=True)
        original_path.unlink(missing_ok=True)
    if hook_path.exists() or selection is not None:
        atomic_write(hook_path, hook, 0o700)
    if selection is None:
        script_path.unlink(missing_ok=True)
    print(json.dumps(selection))
`;
