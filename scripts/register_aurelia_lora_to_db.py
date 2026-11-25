"""
KIREA Studio — Register Trained Aurelia LoRA to Production Database
Registers the trained Aurelia Illustrious LoRA adapter in kirea-studio.db.
"""

import sqlite3
import os
import json
import uuid
from datetime import datetime

db_path = os.path.expandvars(r"%APPDATA%\ai-image-studio-desktop\kirea-studio.db")
print("Target DB path:", db_path)
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. Fetch or create Aurelia character
cur.execute("SELECT id FROM characters WHERE name = 'Aurelia';")
row = cur.fetchone()
now = datetime.utcnow().isoformat() + "Z"

ckpt_file = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI\models\checkpoints\illustrious\Animixy².safetensors"
lora_file = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI\models\loras\aurelia_illustrious_lora.safetensors"

if not row:
    char_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO characters (
            id, name, description, appearance, clothing, prompt_prefix, negative_prompt,
            trigger_words_json, architecture, checkpoint_path, checkpoint_name,
            lora_recipe_id, reference_mode, reference_weight, reference_start, reference_end,
            tags_json, favorite, usage_count, last_used_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        char_id, "Aurelia", "Character DNA Illustrious trained character",
        "short gradient black-and-purple hair, high ponytail, warm brown eyes, beauty mark under left eye",
        "black open jacket, white crop top, casual streetwear", "aurelia_char", "worst quality, low quality",
        json.dumps(["aurelia_char"]), "sdxl",
        ckpt_file, "Animixy²", None, "none", 1.0, 0.0, 1.0,
        json.dumps(["anime", "character-dna", "illustrious", "aurelia"]),
        1, 1, now, now, now
    ))
    print(f"Created Aurelia character with ID: {char_id}")
else:
    char_id = row[0]
    print(f"Aurelia character found with ID: {char_id}")
    # Update prompt prefix and triggers
    cur.execute("""
        UPDATE characters
        SET prompt_prefix = 'aurelia_char',
            trigger_words_json = ?,
            architecture = 'sdxl',
            checkpoint_path = ?,
            checkpoint_name = 'Animixy²',
            updated_at = ?
        WHERE id = ?
    """, (json.dumps(["aurelia_char"]), ckpt_file, now, char_id))

adapter_id = "adapter_aurelia_illustrious_v1"

training_config = {
    "baseModelFamily": "illustrious",
    "baseCheckpointPath": ckpt_file,
    "triggerToken": "aurelia_char",
    "rank": 16,
    "alpha": 16,
    "learningRate": 0.0001,
    "epochs": 10,
    "repeats": 4,
    "totalSteps": 400,
    "batchSize": 1,
    "resolution": 1024,
    "precision": "fp16",
    "backend": "kohya_sd_scripts",
    "finalLoss": 0.128,
    "optimalCheckpoint": "aurelia_illustrious_lora-000008.safetensors (step 320)"
}

eval_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_eval_output"
val_images = [
    os.path.join(eval_dir, "step_320_prompt4_canonical.png"),
    os.path.join(eval_dir, "step_320_prompt1_sundress.png"),
    os.path.join(eval_dir, "step_320_prompt2_portrait_noglasses.png"),
    os.path.join(eval_dir, "step_320_prompt3_cyberpunk.png"),
    os.path.join(eval_dir, "step_400_prompt4_canonical.png")
]

cur.execute("""
    INSERT INTO character_adapters (
        id, character_id, base_model_family, checkpoint_path, checkpoint_name,
        trigger_token, file_location, training_config_json, dataset_version,
        rank, alpha, recommended_strength, status, validation_images_json,
        created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        file_location = excluded.file_location,
        status = excluded.status,
        training_config_json = excluded.training_config_json,
        validation_images_json = excluded.validation_images_json,
        updated_at = excluded.updated_at
""", (
    adapter_id, char_id, "illustrious", ckpt_file, "Animixy²",
    "aurelia_char", lora_file, json.dumps(training_config), "v1.2.3-refined-10",
    16, 16, 0.9, "trained", json.dumps(val_images), now, now
))

conn.commit()
print("Aurelia LoRA adapter successfully registered and committed to production SQLite database!")

cur.execute("SELECT id, character_id, trigger_token, file_location, status, recommended_strength FROM character_adapters WHERE character_id = ?;", (char_id,))
print("Registered adapters for Aurelia in production DB:", cur.fetchall())
conn.close()
