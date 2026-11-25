import os
import hashlib
import json
import sqlite3
from PIL import Image

source_dir = r"C:\Users\Harris\Pictures\Kirea Studio"
db_path = os.path.expandvars(r"%APPDATA%\ai-image-studio-desktop\kirea-studio.db")
output_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset"
os.makedirs(output_dir, exist_ok=True)

candidate_filenames = [
    "kirea_2026-11-22T23-42-50_s3419844246_1.png",
    "kirea_2026-11-22T18-25-02_s1596937497_1.png",
    "kirea_2026-11-22T18-15-42_s179499895_1.png",
    "kirea_2026-11-16T20-07-23_s1792601688_1.png",
    "kirea_2026-11-16T19-57-00_s642999460_1.png",
    "kirea_2026-11-16T19-56-52_s642999459_1.png",
    "kirea_2026-11-20T18-22-55_s1332733342_1.png",
    "kirea_2026-11-16T20-31-59_s385272091_1.png",
    "kirea_2026-11-16T20-04-03_s1692111429_1.png",
    "kirea_2026-11-22T23-51-47_s1017597234_1.png",
    "kirea_2026-11-22T23-51-30_s1372474988_1.png",
    "kirea_2026-11-22T23-51-10_s2400021359_1.png",
    "kirea_2026-11-22T23-50-46_s2511774613_1.png",
    "kirea_2026-11-22T23-43-26_s3253598626_1.png",
    "kirea_2026-11-22T20-32-31_s4214582555_1.png",
    "kirea_2026-11-22T18-46-07_s703375875_1.png",
    "kirea_2026-11-22T18-38-21_s1510709005_1.png",
    "kirea_2026-11-22T18-27-23_s1599156607_1.png",
    "kirea_2026-11-22T18-26-30_s1282011560_1.png",
    "kirea_2026-11-22T18-02-01_s439547070_1.png",
    "kirea_2026-11-22T17-59-58_s1559611108_1.png",
    "kirea_2026-11-22T15-20-10_s1981817852_1.png",
    "kirea_2026-11-22T15-19-52_s309515992_1.png",
    "kirea_2026-11-22T15-18-12_s1804394579_1.png",
    "kirea_2026-11-22T14-58-22_s2084297407_1.png"
]

# Find files recursively
all_files = {}
for root, dirs, files in os.walk(source_dir):
    for f in files:
        if f.lower().endswith(".png"):
            all_files[f] = os.path.join(root, f)

# Connect to database
conn = sqlite3.connect(db_path) if os.path.exists(db_path) else None
cur = conn.cursor() if conn else None

# The 10 selected images after user exclusion of #07, #08, #10
selected_10_set = {1, 3, 9, 11, 12, 13, 14, 15, 16, 20}

# Per-image detailed specs
eval_specs = {
    1: {
        "framing": "Portrait / Close-up",
        "outfit": "Streetwear jacket, open collar, navel piercing (partially in lower frame), thin glasses, hoop earrings",
        "background": "Neutral dark grey studio gradient",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, bangs covering left eye, warm brown eyes, mole under left eye",
        "decision": "SELECTED",
        "reason": "Canonical frontal reference. Exceptional facial detail, clear mole placement under left eye, crisp strand separation. Core identity anchor.",
        "caption": "aurelia_char, 1girl, close-up portrait, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, hoop earrings, streetwear collar, clean lineart, masterpiece, best quality"
    },
    2: {
        "framing": "Portrait / Close-up",
        "outfit": "Red Santa bikini, fur trim, santa hat, lace elbow gloves",
        "background": "Bathroom, tiled wall, sink",
        "canonical_traits": "Short black hair, purple inner gradient, warm brown eyes, pink inner highlights",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Has Santa hat and pink makeup that conflicts with canonical neutral presentation.",
        "caption": None
    },
    3: {
        "framing": "Portrait / Close-up",
        "outfit": "Red Santa bikini strap (minimal visible), large gold hoop earrings, thin glasses",
        "background": "Bathroom, soft defocus blur",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes, smirk",
        "decision": "SELECTED",
        "reason": "Best facial variation in close-up category. Dynamic smirking expression and hoop earrings with minimal bikini exposure (<10% of frame).",
        "caption": "aurelia_char, 1girl, close-up portrait, smirking, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, hoop earrings, expressive face, masterpiece, best quality"
    },
    4: {
        "framing": "Full Body",
        "outfit": "Red Santa bikini, fur-trimmed bikini, lace elbow gloves, red fur thighhighs, santa hat",
        "background": "Bathroom, sink, floor tiles",
        "canonical_traits": "Gradient ponytail, thin glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster. Low eye/face pixel density due to distance; extreme low angle perspective distorts body proportions.",
        "caption": None
    },
    5: {
        "framing": "Full Body",
        "outfit": "Red latex straps, metal studs, open top",
        "background": "Brick wall",
        "canonical_traits": "Gradient hair, glasses",
        "decision": "REJECTED",
        "reason": "Severe rendering artifact: Disembodied third-party arms/hands in frame ('hairy arms holding her'). Corrupts training anatomy.",
        "caption": None
    },
    6: {
        "framing": "Full Body",
        "outfit": "Red latex straps, metal studs, open top",
        "background": "Brick wall",
        "canonical_traits": "Gradient hair, glasses",
        "decision": "REJECTED",
        "reason": "Severe rendering artifact: Identical multi-character limb intrusion issue as #05. Disembodied hands visible.",
        "caption": None
    },
    7: {
        "framing": "Landscape / Wide",
        "outfit": "Casual dark jacket, black top",
        "background": "Futuristic neon cityscape, night sky, illuminated skyscrapers, atmospheric mist",
        "canonical_traits": "Short black hair, purple gradient highlights, high ponytail, hair over left eye, warm brown eyes",
        "decision": "REJECTED",
        "reason": "Removed per user instruction.",
        "caption": None
    },
    8: {
        "framing": "Landscape / Wide",
        "outfit": "Casual streetwear top, seated posture",
        "background": "Warm atmospheric evening backdrop, cinematic staging",
        "canonical_traits": "Short black hair, purple gradient, high ponytail, warm brown eyes",
        "decision": "REJECTED",
        "reason": "Removed per user instruction.",
        "caption": None
    },
    9: {
        "framing": "Landscape / Wide",
        "outfit": "Casual top, open shoulders",
        "background": "Dusk horizon, distant skyline, outdoor lighting",
        "canonical_traits": "Short black hair, purple gradient inner hair, side bangs profile, rear ponytail volume",
        "decision": "SELECTED",
        "reason": "Unique rear-three-quarter turnaround angle ($1472x832). Conditions ponytail attachment point, nape, and hair volume from behind.",
        "caption": "aurelia_char, 1girl, wide shot, profile angle, looking over shoulder, short hair, black hair with purple gradient, high ponytail, side bangs, back hair view, evening sky, city lights, masterpiece, best quality"
    },
    10: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Idol streetwear: black and gold trimmed open jacket, white crop top, navel piercing, thin glasses",
        "background": "Neutral studio backdrop",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye",
        "decision": "REJECTED",
        "reason": "Removed per user instruction.",
        "caption": None
    },
    11: {
        "framing": "Upper Body / Cowboy",
        "outfit": "White crop top, black jacket, thin glasses",
        "background": "Neutral grey backdrop",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes",
        "decision": "SELECTED",
        "reason": "Frontal torso reference with neutral expression ($896x1344). Clean linework without complex background noise.",
        "caption": "aurelia_char, 1girl, cowboy shot, neutral expression, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, crop top, streetwear, crisp lines, masterpiece, best quality"
    },
    12: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Casual dark streetwear, thin glasses",
        "background": "Dramatic directional studio light",
        "canonical_traits": "Vibrant purple gradient strand saturation, high ponytail, warm brown eyes",
        "decision": "SELECTED",
        "reason": "High-saturation purple hair highlight reference ($896x1344). Reinforces gradient color boundaries under intense rim lighting.",
        "caption": "aurelia_char, 1girl, cowboy shot, rim lighting, vibrant purple tips, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, studio lighting, masterpiece, best quality"
    },
    13: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Casual streetwear top, thin glasses",
        "background": "Neutral studio lighting",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye",
        "decision": "SELECTED",
        "reason": "Slight head tilt angle ($896x1344). Strengthens 3D facial geometry and camera gaze alignment.",
        "caption": "aurelia_char, 1girl, cowboy shot, head tilt, direct eye contact, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, stylish outfit, masterpiece, best quality"
    },
    14: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Casual streetwear jacket with structured collar, thin glasses",
        "background": "Neutral gradient backdrop",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes",
        "decision": "SELECTED",
        "reason": "Subtle smile expression ($896x1344). Clean collarbone and shoulder anatomy; high garment texture clarity.",
        "caption": "aurelia_char, 1girl, cowboy shot, gentle smile, casual streetwear jacket, collar, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, masterpiece, best quality"
    },
    15: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Streetwear top, thin glasses",
        "background": "Neutral studio backdrop",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, side-back hair layer visibility",
        "decision": "SELECTED",
        "reason": "Torso turnaround reference ($896x1344). Exposes inner gradient hair layers beneath the main black ponytail.",
        "caption": "aurelia_char, 1girl, cowboy shot, torso turnaround, back gradient layers, short hair, black hair with purple gradient, high ponytail, hair volume, stylish top, masterpiece, best quality"
    },
    16: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini top, fur trim, lace elbow gloves, thin glasses",
        "background": "Bathroom, tiled sink area",
        "canonical_traits": "Short black hair, purple inner gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye",
        "decision": "SELECTED",
        "reason": "Ultra-high resolution ($1120x1680). Exceptional iris shading and mole placement. Retained as 1 of only 3 Santa bikini representations.",
        "caption": "aurelia_char, 1girl, cowboy shot, ultra high resolution, detailed irises, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, red bikini top, fur trim, collarbone, necklace, bathroom, masterpiece, best quality"
    },
    17: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, lace elbow gloves",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Composition and pose nearly identical to #16 without adding new identity features.",
        "caption": None
    },
    18: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, lace elbow gloves, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Over-represents Santa hat and bathroom setting.",
        "caption": None
    },
    19: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, lace elbow gloves",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Side bangs already well represented by #01, #09, and #15.",
        "caption": None
    },
    20: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, lace elbow gloves, santa hat, thin glasses",
        "background": "Bathroom sink, mirror frame",
        "canonical_traits": "Short black hair, purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye",
        "decision": "SELECTED",
        "reason": "Maximum resolution reference in dataset ($1344x2016). Impeccable strand rendering and iris definition. Retained as 2 of 3 Santa bikini shots.",
        "caption": "aurelia_char, 1girl, cowboy shot, ultra high resolution, clean strand separation, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, red bikini, santa hat, lace gloves, bathroom sink, masterpiece, best quality"
    },
    21: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Lower contrast duplicate of #20.",
        "caption": None
    },
    22: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Redundant with #20.",
        "caption": None
    },
    23: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Redundant with #20.",
        "caption": None
    },
    24: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Excluded to ensure Santa bikini images remain strictly limited to 3 out of 13 images.",
        "caption": None
    },
    25: {
        "framing": "Upper Body / Cowboy",
        "outfit": "Red Santa bikini, fur trim, santa hat",
        "background": "Bathroom, sink",
        "canonical_traits": "Gradient hair, ponytail, glasses",
        "decision": "REJECTED",
        "reason": "Redundant Santa bikini cluster duplicate. Excluded to prevent outfit and bathroom lock-in.",
        "caption": None
    }
}

manifest_records = []

for num, fname in enumerate(candidate_filenames, start=1):
    fpath = all_files.get(fname)
    if not fpath:
        print(f"Error: missing {fname}")
        continue

    # Compute SHA-256
    with open(fpath, "rb") as bf:
        sha256_hash = hashlib.sha256(bf.read()).hexdigest()

    with Image.open(fpath) as im:
        w, h = im.size
        ar = round(w / h, 3)

    # Query DB record
    db_rec = {}
    if cur:
        cur.execute(
            "SELECT prompt, negative_prompt, seed, steps, cfg, sampler, checkpoint, created_at FROM generated_images WHERE file_name = ?;",
            (fname,)
        )
        row = cur.fetchone()
        if row:
            db_rec = {
                "prompt": row[0],
                "negative_prompt": row[1],
                "seed": row[2],
                "steps": row[3],
                "cfg": row[4],
                "sampler": row[5],
                "checkpoint": row[6],
                "created_at": row[7]
            }

    spec = eval_specs[num]
    record = {
        "candidate_number": num,
        "filename": fname,
        "absolute_path": fpath,
        "sha256": sha256_hash,
        "resolution": [w, h],
        "aspect_ratio": ar,
        "seed": db_rec.get("seed", fname.split("_s")[1].split("_")[0] if "_s" in fname else None),
        "framing": spec["framing"],
        "outfit": spec["outfit"],
        "background_environment": spec["background"],
        "canonical_identity_traits_visible": spec["canonical_traits"],
        "decision": spec["decision"],
        "decision_reason": spec["reason"],
        "suggested_caption": spec["caption"],
        "generation_metadata": db_rec
    }
    manifest_records.append(record)

selected_list = [r for r in manifest_records if r["decision"] == "SELECTED"]
rejected_list = [r for r in manifest_records if r["decision"] == "REJECTED"]

print(f"Audited all 25 images.")
print(f"Total Selected: {len(selected_list)} images: {[r['candidate_number'] for r in selected_list]}")
print(f"Total Rejected: {len(rejected_list)} images: {[r['candidate_number'] for r in rejected_list]}")

full_manifest_v123 = {
    "version": "1.2.3",
    "dataset_name": "Aurelia_DNA_v1.2.3_Corrected_OptionA",
    "character_name": "Aurelia",
    "trigger_token": "aurelia_char",
    "base_checkpoint": "Animixy².safetensors",
    "total_candidates": 25,
    "selected_count": len(selected_list),
    "rejected_count": len(rejected_list),
    "selected_candidate_numbers": [r["candidate_number"] for r in selected_list],
    "rejected_candidate_numbers": [r["candidate_number"] for r in rejected_list],
    "selected_framing_breakdown": {
        "portrait_close_up": len([r for r in selected_list if "Portrait" in r["framing"]]),
        "cowboy_upper_body": len([r for r in selected_list if "Cowboy" in r["framing"]]),
        "landscape_wide": len([r for r in selected_list if "Landscape" in r["framing"]]),
        "full_body": len([r for r in selected_list if "Full Body" in r["framing"]])
    },
    "selected_outfit_ratio": {
        "streetwear_idol_casual": len([r for r in selected_list if "bikini" not in r["outfit"].lower()]),
        "santa_bikini": len([r for r in selected_list if "bikini" in r["outfit"].lower()])
    },
    "candidates": manifest_records
}

manifest_path = os.path.join(output_dir, "aurelia_dataset_manifest_v123.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(full_manifest_v123, f, indent=2)

print(f"Saved corrected manifest v1.2.3: {manifest_path}")
