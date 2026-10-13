"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Cpu, Monitor, Search, X } from "lucide-react";
import type { AssistantModel, AssistantModelCatalog } from "@boundless/shared";
import styles from "./model-picker.module.css";

type CatalogModel = AssistantModelCatalog["models"][number];
type Provider = { name: string; icon?: string };
type Choice = {
  id: string;
  model: AssistantModel | null;
  label: string;
  provider: Provider;
  available: boolean;
  route?: string;
};

// Presentation metadata only. Every choice comes from the supplied catalog.
const providers: Record<string, Provider> = {
  agent37: { name: "Agent37" },
  openai: { name: "OpenAI", icon: "openai" },
  anthropic: { name: "Anthropic", icon: "anthropic" },
  google: { name: "Google", icon: "google" },
  deepseek: { name: "DeepSeek", icon: "deepseek" },
  mistral: { name: "Mistral", icon: "mistral" },
  mistralai: { name: "Mistral", icon: "mistral" },
  meta: { name: "Meta", icon: "meta" },
  "meta-llama": { name: "Meta", icon: "meta" },
  xai: { name: "xAI", icon: "xai" },
  "x-ai": { name: "xAI", icon: "xai" },
  qwen: { name: "Qwen", icon: "qwen" },
  moonshotai: { name: "Moonshot AI", icon: "moonshotai" },
  minimax: { name: "MiniMax", icon: "minimax" },
  cohere: { name: "Cohere", icon: "cohere" },
  perplexity: { name: "Perplexity", icon: "perplexity" },
  nvidia: { name: "NVIDIA", icon: "nvidia" },
  "z-ai": { name: "Z.ai", icon: "zai" },
  zai: { name: "Z.ai", icon: "zai" },
  openrouter: { name: "OpenRouter", icon: "openrouter" },
  amazon: { name: "Amazon", icon: "amazon-bedrock" },
  microsoft: { name: "Microsoft", icon: "azure" },
};
const providerName = (value: string) =>
  value.replace(/^custom:/, "").replace(/[-_]/g, " ");
function modelProvider(model: AssistantModel): Provider {
  // Routed catalogs retain the original model provider in the model ID.
  const name = (
    model.model.includes("/")
      ? model.model.split("/")[0]
      : model.provider.replace(/^custom:/, "")
  ).toLowerCase();
  return providers[name] || { name: providerName(name) };
}
export const modelKey = (model: AssistantModel | null) =>
  model ? JSON.stringify([model.provider, model.model]) : "";
const isDefaultAlias = (model: AssistantModel | null) =>
  model?.model === "default" && model.provider === "custom:agent37";

function ProviderIcon({ provider }: { provider: Provider }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={styles.providerIcon} aria-hidden="true">
      {provider.icon && failed !== provider.icon ? (
        <img
          src={`/brand/models/${provider.icon}.svg`}
          width="20"
          height="20"
          alt=""
          onError={() => setFailed(provider.icon!)}
        />
      ) : (
        <Cpu size={19} />
      )}
    </span>
  );
}

export function ModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  models: CatalogModel[];
  value: AssistantModel | null;
  disabled: boolean;
  onChange: (model: AssistantModel | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => modelKey(model) === modelKey(value));
  const usesDefault = value === null || isDefaultAlias(value);
  const unavailable = !usesDefault && !selected;
  const label =
    !usesDefault && value
      ? selected?.label || `${value.model} (unavailable)`
      : "Use computer default";
  return (
    <>
      <button
        ref={trigger}
        id="assistant-model"
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby="assistant-model-label assistant-model-value"
        aria-describedby="assistant-model-help"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {!usesDefault && value ? (
          <ProviderIcon provider={modelProvider(value)} />
        ) : (
          <Monitor size={20} aria-hidden="true" />
        )}
        <span id="assistant-model-value" className={styles.triggerName}>
          {label}
        </span>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <PickerDialog
            models={models}
            value={value}
            unavailable={unavailable}
            onSelect={(model) => {
              onChange(model);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
            restoreFocus={() => trigger.current?.focus()}
          />,
          document.body,
        )}
    </>
  );
}

function PickerDialog({
  models,
  value,
  unavailable,
  onSelect,
  onClose,
  restoreFocus,
}: {
  models: CatalogModel[];
  value: AssistantModel | null;
  unavailable: boolean;
  onSelect: (model: AssistantModel | null) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(restoreFocus);
  const id = useId();
  const [query, setQuery] = useState("");
  const selectedKey = isDefaultAlias(value) ? "" : modelKey(value);
  const [active, setActive] = useState(selectedKey);
  const choices = useMemo(() => {
    // Agent37's "default" alias is represented by the single clearing option.
    const catalog: Choice[] = models
      .filter((model) => !isDefaultAlias(model))
      .map((model) => ({
        id: modelKey(model),
        model,
        label: model.label,
        provider: modelProvider(model),
        available: true,
      }));
    // Keep identical names on different routes distinguishable without changing IDs.
    const names = new Map<string, number>();
    for (const choice of catalog) {
      const name = `${choice.provider.name}\0${choice.label}`;
      names.set(name, (names.get(name) || 0) + 1);
    }
    for (const choice of catalog) {
      if (names.get(`${choice.provider.name}\0${choice.label}`)! > 1)
        choice.route = providerName(choice.model!.provider);
    }
    if (unavailable && value)
      catalog.unshift({
        id: modelKey(value),
        model: value,
        label: `${value.model} (unavailable)`,
        provider: modelProvider(value),
        available: false,
      });
    return [
      {
        id: "",
        model: null,
        label: "Use computer default",
        provider: { name: "Default" },
        available: true,
      },
      ...catalog,
    ];
  }, [models, unavailable, value]);
  const groups = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/);
    const result = new Map<string, Choice[]>();
    for (const choice of choices) {
      const text = [
        choice.label,
        choice.provider.name,
        choice.model?.model,
        choice.model?.provider,
      ]
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => text.includes(term))) continue;
      const group = result.get(choice.provider.name) || [];
      group.push(choice);
      result.set(choice.provider.name, group);
    }
    return [...result.entries()];
  }, [choices, query]);
  const visible = groups.flatMap(([, choices]) => choices);
  const enabled = visible.filter((choice) => choice.available);
  const activeChoice =
    enabled.find((choice) => choice.id === active) || enabled[0];
  const optionId = (choice: Choice) =>
    `${id}-option-${choices.indexOf(choice)}`;

  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    search.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      restoreFocusRef.current();
    };
  }, []);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeChoice?.id, query]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Choose assistant model"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className={styles.content}>
        <div className={styles.searchBar}>
          <Search size={19} aria-hidden="true" />
          <input
            ref={search}
            className={styles.search}
            role="combobox"
            aria-label="Search models"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={activeChoice && optionId(activeChoice)}
            placeholder="Search models…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive("");
            }}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                const current = enabled.findIndex(
                  (choice) => choice.id === activeChoice?.id,
                );
                const direction = event.key === "ArrowDown" ? 1 : -1;
                const next =
                  enabled[
                    (current + direction + enabled.length) % enabled.length
                  ];
                if (next) setActive(next.id);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (activeChoice) onSelect(activeChoice.model);
              }
            }}
          />
          <button
            type="button"
            className={styles.close}
            aria-label="Close model selector"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Assistant models"
          className={styles.list}
        >
          {groups.map(([provider, choices], index) => (
            <div
              key={provider}
              role="group"
              aria-labelledby={`${id}-group-${index}`}
              className={styles.group}
            >
              <div id={`${id}-group-${index}`} className={styles.groupHeading}>
                {provider}
              </div>
              {choices.map((choice) => (
                <div
                  key={choice.id}
                  id={optionId(choice)}
                  ref={activeChoice?.id === choice.id ? activeRow : undefined}
                  role="option"
                  aria-selected={choice.id === selectedKey}
                  aria-disabled={!choice.available || undefined}
                  className={`${styles.option} ${activeChoice?.id === choice.id ? styles.active : ""}`}
                  onMouseMove={() => {
                    if (choice.available) setActive(choice.id);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (choice.available) onSelect(choice.model);
                  }}
                >
                  {choice.model ? (
                    <ProviderIcon provider={choice.provider} />
                  ) : (
                    <Monitor size={20} aria-hidden="true" />
                  )}
                  <span className={styles.optionName}>{choice.label}</span>
                  {choice.route && (
                    <span className={styles.route}>{choice.route}</span>
                  )}
                  {choice.id === selectedKey && (
                    <Check
                      size={17}
                      className={styles.check}
                      aria-hidden="true"
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          {visible.length === 0 && (
            <p role="status" className={styles.empty}>
              No models found.
              <span>Try a different model or provider name.</span>
            </p>
          )}
        </div>
        <p className={styles.hint}>
          ↑ ↓ to browse · Enter to choose · Esc to close
        </p>
      </div>
    </dialog>
  );
}
