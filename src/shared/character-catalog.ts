export interface TraitOption {
  value: string;
  label: string;
  category: string;
  description?: string;
}

export const GENDER_CATALOG: { category: string; options: TraitOption[] }[] = [
  {
    category: "Primary Presentations",
    options: [
      { value: "Female", label: "Female (1girl)", category: "Primary Presentations", description: "Female identity and feminine anatomy" },
      { value: "Male", label: "Male (1boy)", category: "Primary Presentations", description: "Male identity and masculine anatomy" },
      { value: "Femboy", label: "Femboy (Otokonoko)", category: "Primary Presentations", description: "Feminine presenting male / cute feminine aesthetic" },
      { value: "Tomboy", label: "Tomboy", category: "Primary Presentations", description: "Boyish / masculine presenting female" },
    ],
  },
  {
    category: "Trans & Non-Binary",
    options: [
      { value: "Transgender", label: "Transgender", category: "Trans & Non-Binary", description: "Transgender presentation and identity" },
      { value: "Trans Woman", label: "Trans Woman (MTF)", category: "Trans & Non-Binary", description: "Transgender woman" },
      { value: "Trans Man", label: "Trans Man (FTM)", category: "Trans & Non-Binary", description: "Transgender man" },
      { value: "Androgynous", label: "Androgynous", category: "Trans & Non-Binary", description: "Gender-neutral or ambiguous appearance" },
      { value: "Non-Binary", label: "Non-Binary", category: "Trans & Non-Binary", description: "Neither strictly male nor female" },
      { value: "Genderfluid", label: "Genderfluid", category: "Trans & Non-Binary", description: "Fluid and shifting gender expression" },
    ],
  },
];

export const POPULAR_GENDER_PRESETS = [
  "Female",
  "Male",
  "Transgender",
  "Femboy",
  "Tomboy",
  "Androgynous",
];

export const SPECIES_CATALOG: { category: string; options: TraitOption[] }[] = [
  {
    category: "Human & Mortal",
    options: [
      { value: "Human", label: "Human", category: "Human & Mortal", description: "Standard mortal human" },
      { value: "Cyborg", label: "Cyborg", category: "Human & Mortal", description: "Human with prominent cybernetic implants" },
    ],
  },
  {
    category: "Demi-Human & Kemonomimi",
    options: [
      { value: "Kitsune", label: "Kitsune (Fox-folk)", category: "Demi-Human & Kemonomimi", description: "Fox ears and multiple bushy tails" },
      { value: "Neko", label: "Neko (Cat-folk)", category: "Demi-Human & Kemonomimi", description: "Feline ears, tail, and graceful agility" },
      { value: "Wolf-folk", label: "Wolf-folk (Ookami)", category: "Demi-Human & Kemonomimi", description: "Wolf ears, tail, and fierce loyalty" },
      { value: "Bunny-folk", label: "Bunny-folk (Usagimimi)", category: "Demi-Human & Kemonomimi", description: "Rabbit ears, nimble and alert" },
      { value: "Dragon-kin", label: "Dragon-kin (Draconian)", category: "Demi-Human & Kemonomimi", description: "Reptilian horns, scales, slit pupils, and tail" },
      { value: "Beastkin", label: "Beastkin", category: "Demi-Human & Kemonomimi", description: "General anthropomorphic or animal-eared heritage" },
    ],
  },
  {
    category: "Fantasy & Arcane",
    options: [
      { value: "Elf", label: "Elf (High / Wood)", category: "Fantasy & Arcane", description: "Graceful, long pointed ears, attuned to nature or magic" },
      { value: "Dark Elf", label: "Dark Elf (Drow)", category: "Fantasy & Arcane", description: "Ash or obsidian skin with silver or pale hair" },
      { value: "Dwarf", label: "Dwarf", category: "Fantasy & Arcane", description: "Compact, sturdy physique, master artisan or warrior" },
      { value: "Fairy", label: "Fairy / Pixie", category: "Fantasy & Arcane", description: "Gossamer translucent wings, radiant magic dust" },
      { value: "Merfolk", label: "Merfolk / Siren", category: "Fantasy & Arcane", description: "Aquatic fins, ear frills, and iridescent scales" },
    ],
  },
  {
    category: "Mythic & Supernatural",
    options: [
      { value: "Oni", label: "Oni / Demon-kin", category: "Mythic & Supernatural", description: "Demonic horns, fangs, immense strength" },
      { value: "Angel", label: "Angel / Seraph", category: "Mythic & Supernatural", description: "Feathered wings, celestial halo, luminous aura" },
      { value: "Vampire", label: "Vampire", category: "Mythic & Supernatural", description: "Nocturnal aristocrat, fangs, pale complexion" },
      { value: "Yokai", label: "Yokai / Ayakashi", category: "Mythic & Supernatural", description: "Spiritual entity from Japanese folklore" },
      { value: "Ghost", label: "Ghost / Wraith", category: "Mythic & Supernatural", description: "Ethereal translucent spirit with spectral glow" },
    ],
  },
  {
    category: "Sci-Fi & Synthetic",
    options: [
      { value: "Android", label: "Android / Gynoid", category: "Sci-Fi & Synthetic", description: "Synthetic artificial humanoid, sleek chassis" },
      { value: "Automaton", label: "Automaton / Mech", category: "Sci-Fi & Synthetic", description: "Clockwork or heavy mechanical frame" },
      { value: "AI Hologram", label: "AI Hologram", category: "Sci-Fi & Synthetic", description: "Digital projection with neon chromatic aberration" },
      { value: "Alien", label: "Alien / Extraterrestrial", category: "Sci-Fi & Synthetic", description: "Otherworldly extraterrestrial morphology" },
    ],
  },
];

export const POPULAR_SPECIES_PRESETS = [
  "Human",
  "Kitsune",
  "Elf",
  "Cyborg",
  "Dragon-kin",
  "Android",
  "Oni",
  "Vampire",
];

export const ARCHETYPE_CATALOG: { category: string; options: TraitOption[] }[] = [
  {
    category: "Combat & Martial",
    options: [
      { value: "Ronin", label: "Ronin (Wandering Swordsman)", category: "Combat & Martial", description: "Masterless swordsman walking the borderlands" },
      { value: "Warrior", label: "Warrior / Knight", category: "Combat & Martial", description: "Disciplined martial champion in plate armor" },
      { value: "Assassin", label: "Assassin / Shinobi", category: "Combat & Martial", description: "Stealth operative dealing lethality from the shadows" },
      { value: "Gunslinger", label: "Gunslinger / Sniper", category: "Combat & Martial", description: "Quick-draw marksman with firearms or rifles" },
      { value: "Bounty Hunter", label: "Bounty Hunter / Mercenary", category: "Combat & Martial", description: "Pragmatic soldier for hire tracking high-value marks" },
      { value: "Martial Artist", label: "Martial Artist / Monk", category: "Combat & Martial", description: "Unarmed combatant channeling spiritual energy" },
      { value: "Paladin", label: "Paladin / Crusader", category: "Combat & Martial", description: "Holy defender wielding radiant bastion magic" },
    ],
  },
  {
    category: "Arcane & Intellect",
    options: [
      { value: "Mage", label: "Mage / Sorcerer", category: "Arcane & Intellect", description: "Arcane spellcaster weaving elemental destruction" },
      { value: "Alchemist", label: "Alchemist / Artificer", category: "Arcane & Intellect", description: "Brewer of strange potions and magical technology" },
      { value: "Scholar", label: "Scholar / Sage", category: "Arcane & Intellect", description: "Keeper of ancient grimoires and forbidden truths" },
      { value: "Healer", label: "Healer / Cleric", category: "Arcane & Intellect", description: "Support medic restoring vitality and curing wounds" },
      { value: "Necromancer", label: "Necromancer / Dark Cultist", category: "Arcane & Intellect", description: "Master of soul harvesting and forbidden death rites" },
      { value: "Witch", label: "Witch / Warlock", category: "Arcane & Intellect", description: "Pact-bound occult practitioner with familiars" },
    ],
  },
  {
    category: "Rogue & Infiltration",
    options: [
      { value: "Netrunner", label: "Netrunner / Hacker", category: "Rogue & Infiltration", description: "Cyber-deck maestro slicing corporate ICE" },
      { value: "Thief", label: "Thief / Rogue", category: "Rogue & Infiltration", description: "Nimble pickpocket and infiltration specialist" },
      { value: "Smuggler", label: "Smuggler / Scoundrel", category: "Rogue & Infiltration", description: "Charismatic law-evader navigating dangerous trade routes" },
      { value: "Trickster", label: "Trickster / Illusionist", category: "Rogue & Infiltration", description: "Master of deception, misdirection, and theatrical bluffs" },
      { value: "Rebel", label: "Rebel / Insurgent", category: "Rogue & Infiltration", description: "Freedom fighter defying authoritarian rule" },
    ],
  },
  {
    category: "Leadership & Order",
    options: [
      { value: "Commander", label: "Military Commander / Captain", category: "Leadership & Order", description: "Battlefield tactician directing squads and fleets" },
      { value: "Royalty", label: "Royalty / Aristocrat", category: "Leadership & Order", description: "Noble heir or ruler governing high-court politics" },
      { value: "Detective", label: "Detective / Investigator", category: "Leadership & Order", description: "Gritty investigator unravelling urban secrets" },
      { value: "Enforcer", label: "Enforcer / Lawkeeper", category: "Leadership & Order", description: "Strict maintainer of justice and security" },
    ],
  },
  {
    category: "Narrative & Modern",
    options: [
      { value: "High School Student", label: "High School Student", category: "Narrative & Modern", description: "Everyday youth with hidden potential" },
      { value: "Idol", label: "Idol / Performer", category: "Narrative & Modern", description: "Charismatic musical artist captivating crowds" },
      { value: "Maid", label: "Maid / Butler", category: "Narrative & Modern", description: "Impeccably poised attendant with hidden combat talents" },
      { value: "Mecha Pilot", label: "Mecha Pilot", category: "Narrative & Modern", description: "Ace operator of giant bipedal battle armor" },
      { value: "Street Brawler", label: "Street Delinquent / Brawler", category: "Narrative & Modern", description: "Leather-jacket youth ruling neon alleyways" },
      { value: "Nomad", label: "Nomad / Wanderer", category: "Narrative & Modern", description: "Solitary traveller exploring ruined frontiers" },
    ],
  },
];

export const POPULAR_ARCHETYPE_PRESETS = [
  "Ronin",
  "Netrunner",
  "Warrior",
  "Mage",
  "Assassin",
  "Gunslinger",
  "Idol",
  "Mecha Pilot",
];
