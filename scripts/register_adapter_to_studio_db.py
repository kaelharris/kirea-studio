import sqlite3
import os
import json
import uuid
from datetime import datetime

db_path = os.path.expandvars(r"%APPDATA%\ai-image-studio-desktop\kirea-studio.db")
print("Target DB path:", db_path)
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Check if Aurelia exists
cur.execute("SELECT id FROM characters WHERE name = 'Aurelia';")
row = cur.fetchone()
now = datetime.utcnow().isoformat() + "Z"

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
        char_id, "Aurelia", "Character DNA v1.2 candidate character",
        "short gradient black-and-purple hair, high ponytail, warm brown eyes, beauty mark under left eye",
        "stylish idol / casual streetwear", "aurelia_char", "worst quality, low quality",
        json.dumps(["aurelia_char"]), "sdxl",
        r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI\models\checkpoints\illustrious\Animixy².safetensors",
        "Animixy²", None, "none", 1.0, 0.0, 1.0,
        json.dumps(["anime", "character-dna", "gradient-hair"]),
        1, 0, None, now, now
    ))
    print(f"Created Aurelia character with ID: {char_id}")
else:
    char_id = row[0]
    print(f"Aurelia character already exists with ID: {char_id}")

adapter_id = "adapter_smoke_test_animixy"
lora_file = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI\models\loras\smoke_test_animixy_lora.safetensors"
ckpt_file = r"C:\Users\Harris\Documents\ComfyUI\TES\ComfyUI\models\checkpoints\illustrious\Animixy².safetensors"

training_config = {
    "baseModelFamily": "illustrious",
    "baseCheckpointPath": ckpt_file,
    "triggerToken": "smoke_test_token",
    "rank": 16,
    "alpha": 16,
    "learningRate": 1e-4,
    "epochs": 1,
    "batchSize": 1,
    "resolution": 1024,
    "precision": "fp16"
}

val_images = [
    r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\comfyui_verification_output\generation_B_lora.png"
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
        updated_at = excluded.updated_at
""", (
    adapter_id, char_id, "illustrious", ckpt_file, "Animixy²",
    "smoke_test_token", lora_file, json.dumps(training_config), "v0.1-smoke",
    16, 16, 1.0, "trained", json.dumps(val_images), now, now
))

conn.commit()
print("Adapter successfully registered and committed to production SQLite database!")

cur.execute("SELECT id, character_id, trigger_token, file_location, status FROM character_adapters;")
print("Current registered adapters in production DB:", cur.fetchall())
conn.close()
