import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Copy,
  ImagePlus,
  Lock,
  Sparkles,
  UserCheck,
  Wand2,
} from "lucide-react";
import { ARCHITECTURE_LABELS } from "../../../shared/model-utils";
import {
  CHARACTER_REFERENCE_CATEGORY_LABELS,
  composeCharacterPrompt,
} from "../../../shared/character-utils";
import {
  GENDER_CATALOG,
  POPULAR_GENDER_PRESETS,
  SPECIES_CATALOG,
  POPULAR_SPECIES_PRESETS,
  ARCHETYPE_CATALOG,
  POPULAR_ARCHETYPE_PRESETS,
} from "../../../shared/character-catalog";
import { TraitSelectGroup } from "./TraitSelectGroup";
import type {
  CharacterIdentityCore,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReferenceCategory,
  ModelArchitecture,
  ModelRecord,
} from "../../../shared/types";
import { Badge, Button, Input, Modal, Select, Textarea } from "../ui/Primitives";

interface CharacterWizardModalProps {
  open: boolean;
  onClose: () => void;
  models: ModelRecord[];
  onSaveCharacter: (input: CharacterProfileInput) => Promise<CharacterProfile>;
  onUseCharacter: (character: CharacterProfile) => void;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

const STEPS_CONFIG = [
  { step: 1, title: "Describe", subtitle: "Core Identity & Name" },
  { step: 2, title: "Appearance", subtitle: "Fixed Physical DNA" },
  { step: 3, title: "References", subtitle: "Canonical Imagery" },
  { step: 4, title: "Review", subtitle: "Consistency Check" },
  { step: 5, title: "Complete", subtitle: "Ready for Creation" },
];

export const CharacterWizardModal: React.FC<CharacterWizardModalProps> = ({
  open,
  onClose,
  models,
  onSaveCharacter,
  onUseCharacter,
  onToast,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Form State
  const [name, setName] = useState("");
  const [gender, setGender] = useState("Female");
  const [ageCategory, setAgeCategory] = useState("Young Adult");
  const [species, setSpecies] = useState("Human");
  const [archetype, setArchetype] = useState("Ronin");
  const [description, setDescription] = useState("");
  const [triggerToken, setTriggerToken] = useState("");

  // Appearance DNA
  const [hairColor, setHairColor] = useState("");
  const [hairStyle, setHairStyle] = useState("");
  const [eyeColor, setEyeColor] = useState("");
  const [skinTone, setSkinTone] = useState("");
  const [facialCharacteristics, setFacialCharacteristics] = useState("");
  const [distinctiveFeaturesText, setDistinctiveFeaturesText] = useState("");
  const [signatureAccessoriesText, setSignatureAccessoriesText] = useState("");
  const [bodyCharacteristics, setBodyCharacteristics] = useState("");
  const [preferredStyle, setPreferredStyle] = useState("Anime / Cinematic");
  const [negativeConstraints, setNegativeConstraints] = useState("");
  const [dnaLocked, setDnaLocked] = useState(true);

  // Architecture & Checkpoint
  const [architecture, setArchitecture] = useState<ModelArchitecture>("illustrious");
  const [checkpointPath, setCheckpointPath] = useState("");

  // Saved character after step 5
  const [savedCharacter, setSavedCharacter] = useState<CharacterProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // References added during wizard
  const [pendingRefs, setPendingRefs] = useState<
    Array<{ filePath: string; role: "primary" | "secondary"; category: CharacterReferenceCategory }>
  >([]);

  // Auto-generate trigger token when name changes
  const handleNameChange = (val: string) => {
    setName(val);
    if (!triggerToken || triggerToken.startsWith("kirea_")) {
      const slug = val.toLowerCase().replace(/[^a-z0-9]/g, "_");
      setTriggerToken(slug ? `kirea_${slug}` : "");
    }
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (!name.trim()) {
        onToast("Please give your character a name.", "error");
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(4);
    } else if (currentStep === 4) {
      void handleSaveAndFinish();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleSaveAndFinish = async () => {
    setSaving(true);
    try {
      const dna: Partial<CharacterIdentityCore> = {
        triggerToken: triggerToken.trim(),
        gender,
        ageCategory,
        species,
        archetype,
        hairColor,
        hairStyle,
        eyeColor,
        skinTone,
        facialCharacteristics,
        distinctiveFeatures: distinctiveFeaturesText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        signatureAccessories: signatureAccessoriesText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        bodyCharacteristics,
        preferredStyle,
        negativeConstraints,
        dnaLocked,
      };

      const fixedTraits = [
        hairColor ? `${hairColor} hair` : null,
        hairStyle || null,
        eyeColor ? `${eyeColor} eyes` : null,
        skinTone ? `${skinTone} skin` : null,
        ...distinctiveFeaturesText.split(",").map((s) => s.trim()).filter(Boolean),
      ].filter(Boolean) as string[];

      dna.fixedTraits = fixedTraits;

      const saved = await onSaveCharacter({
        name: name.trim(),
        description: description.trim(),
        appearance: fixedTraits.join(", "),
        promptPrefix: triggerToken.trim(),
        negativePrompt: negativeConstraints.trim(),
        triggerWords: [triggerToken.trim()].filter(Boolean),
        architecture,
        checkpointPath: checkpointPath || null,
        dna,
      });

      setSavedCharacter(saved);
      setCurrentStep(5);
      onToast(`Character '${saved.name}' created with locked DNA!`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName("");
    setGender("Female");
    setAgeCategory("Young Adult");
    setSpecies("Human");
    setArchetype("Ronin");
    setDescription("");
    setTriggerToken("");
    setHairColor("");
    setHairStyle("");
    setEyeColor("");
    setSkinTone("");
    setFacialCharacteristics("");
    setDistinctiveFeaturesText("");
    setSignatureAccessoriesText("");
    setBodyCharacteristics("");
    setPreferredStyle("Anime / Cinematic");
    setNegativeConstraints("");
    setDnaLocked(true);
    setArchitecture("illustrious");
    setCheckpointPath("");
    setSavedCharacter(null);
    setCurrentStep(1);
    setPendingRefs([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      closeOnBackdropClick={false}
      title="Character DNA Studio — Identity Wizard"
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-6">
        {/* Step Progress Bar */}
        <div className="grid grid-cols-5 gap-2 border-b-2 border-border pb-4">
          {STEPS_CONFIG.map(({ step, title, subtitle }) => {
            const isActive = currentStep === step;
            const isCompleted = currentStep > step;
            return (
              <div
                key={step}
                className={`p-2 border-2 transition-all ${
                  isActive
                    ? "border-accent bg-accent/10"
                    : isCompleted
                    ? "border-[#F2F2EE] bg-surface-subtle"
                    : "border-border/40 opacity-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
                  <span
                    className={`w-4 h-4 rounded-none flex items-center justify-center font-bold border ${
                      isActive
                        ? "bg-accent text-white border-accent"
                        : isCompleted
                        ? "bg-[#F2F2EE] text-[#0B0C10] border-[#F2F2EE]"
                        : "border-border text-fg-subtle"
                    }`}
                  >
                    {step}
                  </span>
                  <span className={isActive ? "text-accent font-bold" : "text-fg"}>
                    {title}
                  </span>
                </div>
                <div className="text-[10px] text-fg-subtle truncate mt-0.5">
                  {subtitle}
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 1: Describe */}
        {currentStep === 1 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-1">
              <h3 className="text-sm font-bold text-fg">Step 1 — Canonical Identity</h3>
              <p className="text-xs text-fg-muted">
                Establish the name, demographic core, and immutable trigger token for this character.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Character Name *
                </label>
                <Input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Ren Kisaragi"
                  className="h-9 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Trigger Token (LoRA / Identity Token)
                </label>
                <Input
                  value={triggerToken}
                  onChange={(e) => setTriggerToken(e.target.value)}
                  placeholder="e.g. kirea_ren"
                  className="h-9 font-mono"
                />
                <p className="text-[10px] text-fg-subtle">
                  Injected first into generations to anchor the identity.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <TraitSelectGroup
                label="1. Gender Specification (Primary Anchor)"
                value={gender}
                onChange={setGender}
                catalog={GENDER_CATALOG}
                popularPresets={POPULAR_GENDER_PRESETS}
                placeholder="e.g. Female, Male, Transgender, Femboy..."
                description="Primary anatomical anchor (1girl, 1boy, femboy, etc.)."
              />

              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Age Category
                </label>
                <Select
                  value={ageCategory}
                  onChange={(e) => setAgeCategory(e.target.value)}
                  className="h-9 text-xs font-mono"
                >
                  <option value="Child">Child (7-12)</option>
                  <option value="Teen">Teenager (13-17)</option>
                  <option value="Young Adult">Young Adult (18-25)</option>
                  <option value="Adult">Adult (26-45)</option>
                  <option value="Elderly">Mature / Elder (46+)</option>
                </Select>
                <p className="text-[10px] text-fg-subtle">
                  Defines age stage and maturity characteristics.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <TraitSelectGroup
                label="Species"
                value={species}
                onChange={setSpecies}
                catalog={SPECIES_CATALOG}
                popularPresets={POPULAR_SPECIES_PRESETS}
                placeholder="e.g. Kitsune, Cyborg, Elf, Android..."
                description="Defines physical species morphology and traits."
              />
              <TraitSelectGroup
                label="Archetype"
                value={archetype}
                onChange={setArchetype}
                catalog={ARCHETYPE_CATALOG}
                popularPresets={POPULAR_ARCHETYPE_PRESETS}
                placeholder="e.g. Ronin, Netrunner, Assassin, Mage..."
                description="Defines thematic role, narrative tropes, and posture."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                Character Concept & Personality Summary
              </label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A solitary ronin hacker wandering neon-lit Neo-Kyoto with an antique katana and neural cyberdeck..."
              />
            </div>
          </div>
        )}

        {/* Step 2: Canonical Appearance */}
        {currentStep === 2 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-1">
              <h3 className="text-sm font-bold text-fg">Step 2 — Fixed Physical Appearance</h3>
              <p className="text-xs text-fg-muted">
                Define the immutable biological and visual features that never drift across generations.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Hair Color
                </label>
                <Input
                  value={hairColor}
                  onChange={(e) => setHairColor(e.target.value)}
                  placeholder="e.g. jet black, silver"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Hair Style
                </label>
                <Input
                  value={hairStyle}
                  onChange={(e) => setHairStyle(e.target.value)}
                  placeholder="e.g. messy ponytail, bob cut"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Eye Color
                </label>
                <Input
                  value={eyeColor}
                  onChange={(e) => setEyeColor(e.target.value)}
                  placeholder="e.g. crimson, amber, violet"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Skin Tone
                </label>
                <Input
                  value={skinTone}
                  onChange={(e) => setSkinTone(e.target.value)}
                  placeholder="e.g. fair, sun-tanned, deep"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Distinctive Features (Comma separated)
                </label>
                <Input
                  value={distinctiveFeaturesText}
                  onChange={(e) => setDistinctiveFeaturesText(e.target.value)}
                  placeholder="scar across right eye, beauty mark under left eye"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Signature Accessories (Comma separated)
                </label>
                <Input
                  value={signatureAccessoriesText}
                  onChange={(e) => setSignatureAccessoriesText(e.target.value)}
                  placeholder="crimson scarf, cybernetic ear cuff"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Preferred Visual Style
                </label>
                <Input
                  value={preferredStyle}
                  onChange={(e) => setPreferredStyle(e.target.value)}
                  placeholder="e.g. Anime halftone aesthetic, 90s cel shaded, ink wash"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Negative Identity Constraints
                </label>
                <Input
                  value={negativeConstraints}
                  onChange={(e) => setNegativeConstraints(e.target.value)}
                  placeholder="glasses, earrings, blonde hair, freckles"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="p-3 border-2 border-border bg-bg flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-accent" />
                  <span className="text-xs font-bold text-fg">DNA Lock</span>
                  <Badge tone={dnaLocked ? "accent" : "neutral"}>
                    {dnaLocked ? "LOCKED" : "UNLOCKED"}
                  </Badge>
                </div>
                <p className="text-[11px] text-fg-subtle">
                  Locks fixed appearance traits to prevent accidental edits or prompt drift in Creation Studio.
                </p>
              </div>
              <input
                type="checkbox"
                checked={dnaLocked}
                onChange={(e) => setDnaLocked(e.target.checked)}
                className="w-4 h-4 accent-accent cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* Step 3: References & Architecture */}
        {currentStep === 3 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-1">
              <h3 className="text-sm font-bold text-fg">Step 3 — Target Model & Reference Setup</h3>
              <p className="text-xs text-fg-muted">
                Select the base model architecture and attach initial references to build this character's visual memory.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Target Architecture
                </label>
                <Select
                  value={architecture}
                  onChange={(e) => setArchitecture(e.target.value as ModelArchitecture)}
                  className="h-9 text-xs"
                >
                  <option value="illustrious">Illustrious XL (Recommended Anime)</option>
                  <option value="sdxl">SDXL 1.0 (General High Quality)</option>
                  <option value="pony">Pony Diffusion V6</option>
                  <option value="moss_image">MOSS-Image</option>
                  <option value="sd15">SD 1.5 Legacy</option>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Default Checkpoint (Optional)
                </label>
                <Select
                  value={checkpointPath}
                  onChange={(e) => setCheckpointPath(e.target.value)}
                  className="h-9 text-xs"
                >
                  <option value="">Use current studio checkpoint</option>
                  {models
                    .filter((m) => m.category === "checkpoint" && m.installed)
                    .map((m) => (
                      <option key={m.id} value={m.relativePath}>
                        [{ARCHITECTURE_LABELS[m.architecture]}] {m.name}
                      </option>
                    ))}
                </Select>
              </div>
            </div>

            <div className="p-4 border-2 border-dashed border-border bg-surface/40 flex flex-col items-center justify-center text-center space-y-2">
              <ImagePlus className="w-8 h-8 text-fg-subtle" />
              <div className="text-xs font-bold text-fg">Visual Memory References</div>
              <p className="text-[11px] text-fg-subtle max-w-md">
                Reference images and turnaround sheets can be attached immediately after wizard completion in the <b>Visual Memory</b> workspace, where you can tag, approve, and crop them.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Consistency Review */}
        {currentStep === 4 && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-1">
              <h3 className="text-sm font-bold text-fg">Step 4 — Character Consistency Review</h3>
              <p className="text-xs text-fg-muted">
                Confirm your canonical identity and verify how identity tokens will be composed.
              </p>
            </div>

            <div className="p-4 border-2 border-border bg-bg space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div>
                  <h4 className="text-base font-bold text-fg flex items-center gap-2">
                    {name}
                    {dnaLocked && (
                      <Badge tone="accent">DNA LOCKED</Badge>
                    )}
                  </h4>
                  <div className="text-xs text-fg-subtle">
                    {gender} · {ageCategory} · {species} · {archetype} · {preferredStyle}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono text-label uppercase">Architecture</div>
                  <Badge tone="neutral">{ARCHITECTURE_LABELS[architecture]}</Badge>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-label block">
                  Identity Core Tokens (Trigger + Fixed Traits)
                </span>
                <div className="p-2 border border-border bg-surface-subtle font-mono text-xs text-fg break-all">
                  <span className="text-accent font-bold">{triggerToken}</span>
                  {hairColor && `, ${hairColor} hair`}
                  {hairStyle && `, ${hairStyle}`}
                  {eyeColor && `, ${eyeColor} eyes`}
                  {skinTone && `, ${skinTone} skin`}
                  {distinctiveFeaturesText && `, ${distinctiveFeaturesText}`}
                  {signatureAccessoriesText && `, ${signatureAccessoriesText}`}
                </div>
              </div>

              {negativeConstraints && (
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-label block">
                    Negative Identity Constraints
                  </span>
                  <div className="p-2 border border-border bg-surface-subtle font-mono text-xs text-warning break-all">
                    {negativeConstraints}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Completed */}
        {currentStep === 5 && savedCharacter && (
          <div className="py-6 text-center space-y-4 animate-fadeIn">
            <div className="w-12 h-12 border-2 border-accent bg-accent/10 text-accent flex items-center justify-center mx-auto">
              <CheckCircle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-fg">Character Identity Created!</h3>
              <p className="text-xs text-fg-muted mt-1 max-w-md mx-auto">
                <b>{savedCharacter.name}</b> has been registered in KIREA Studio with locked DNA. You can now curate reference images, build a training dataset, or start generating immediately.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-3">
              <Button
                variant="primary"
                onClick={() => {
                  onUseCharacter(savedCharacter);
                  handleClose();
                }}
              >
                <Wand2 className="w-4 h-4" />
                Open in Creation Studio
              </Button>
              <Button variant="secondary" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Navigation Actions */}
        {currentStep < 5 && (
          <div className="pt-4 border-t-2 border-border flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={currentStep === 1 ? handleClose : handleBack}
            >
              {currentStep === 1 ? "Cancel" : <><ArrowLeft className="w-3.5 h-3.5" /> Back</>}
            </Button>

            <Button
              variant={currentStep === 4 ? "accent" : "primary"}
              loading={saving}
              onClick={handleNext}
            >
              {currentStep === 4 ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Save & Lock Identity
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};
