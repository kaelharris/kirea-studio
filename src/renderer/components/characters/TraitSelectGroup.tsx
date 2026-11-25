import React, { useState, useEffect } from "react";
import type { TraitOption } from "../../../shared/character-catalog";
import { Input, Select } from "../ui/Primitives";

interface TraitSelectGroupProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  catalog: { category: string; options: TraitOption[] }[];
  popularPresets: string[];
  placeholder?: string;
  description?: string;
}

export const TraitSelectGroup: React.FC<TraitSelectGroupProps> = ({
  label,
  value,
  onChange,
  catalog,
  popularPresets,
  placeholder = "Specify custom value...",
  description,
}) => {
  // Collect all known catalog values
  const allKnownValues = React.useMemo(() => {
    const set = new Set<string>();
    for (const group of catalog) {
      for (const opt of group.options) {
        set.add(opt.value);
      }
    }
    return set;
  }, [catalog]);

  const isKnown = allKnownValues.has(value);
  const [isCustomMode, setIsCustomMode] = useState(!isKnown && value !== "");

  useEffect(() => {
    if (!allKnownValues.has(value) && value !== "") {
      setIsCustomMode(true);
    }
  }, [value, allKnownValues]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__custom__") {
      setIsCustomMode(true);
      // Keep existing custom value or clear if it was a known one
      if (allKnownValues.has(value)) {
        onChange("");
      }
    } else {
      setIsCustomMode(false);
      onChange(val);
    }
  };

  const handleChipClick = (preset: string) => {
    setIsCustomMode(false);
    onChange(preset);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
          {label}
        </label>
        {isCustomMode && (
          <button
            type="button"
            onClick={() => {
              setIsCustomMode(false);
              onChange(popularPresets[0] || "Human");
            }}
            className="text-[10px] font-mono text-accent hover:underline cursor-pointer"
          >
            ← Back to presets
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <Select
          value={isCustomMode ? "__custom__" : (isKnown ? value : "__custom__")}
          onChange={handleSelectChange}
          className="h-9 text-xs font-mono"
        >
          <option value="" disabled>-- Select {label} --</option>
          {catalog.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Custom">
            <option value="__custom__">Custom / Other...</option>
          </optgroup>
        </Select>

        {isCustomMode && (
          <div className="pt-0.5">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="h-8 text-xs font-mono"
              autoFocus
            />
          </div>
        )}

        {/* Quick-select chips */}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {popularPresets.map((preset) => {
            const isSelected = value.toLowerCase() === preset.toLowerCase();
            return (
              <button
                key={preset}
                type="button"
                onClick={() => handleChipClick(preset)}
                className={`px-2 py-0.5 text-[10px] font-mono border transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-accent text-white border-accent font-bold"
                    : "bg-surface text-fg-muted border-border hover:border-fg hover:text-fg"
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>
      </div>

      {description && (
        <p className="text-[10px] text-fg-subtle">{description}</p>
      )}
    </div>
  );
};
