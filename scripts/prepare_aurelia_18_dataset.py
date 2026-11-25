"""
KIREA Studio — Aurelia 18-Image Dataset Preparer
Copies selected 18 images from C:\\Users\\Harris\\Pictures\\Kirea Studio into a dedicated
training directory and creates paired, decoupled .txt captions with trigger token aurelia_char.
"""

import os
import shutil
import json
from PIL import Image

manifest_file = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_dataset\aurelia_dataset_manifest.json"
train_dataset_dir = r"c:\Users\Harris\Documents\Ultimate AI\Projects\Kirea Studio\ai-image-studio-desktop\temp\aurelia_train_dataset"
os.makedirs(train_dataset_dir, exist_ok=True)

# Clean existing contents if any
for f in os.listdir(train_dataset_dir):
    os.remove(os.path.join(train_dataset_dir, f))

with open(manifest_file, "r", encoding="utf-8") as f:
    manifest = json.load(f)

# Selected 18 numbers according to Option A:
# Excludes #05, #06 (artifacts) and redundant Santa duplicates (#17, #19, #21, #22, #23)
selected_numbers = [1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 25]

# Specific decoupled tags per selected image
caption_overrides = {
    1: "aurelia_char, 1girl, close-up portrait, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, hoop earrings, streetwear collar, clean lineart, masterpiece, best quality",
    2: "aurelia_char, 1girl, close-up portrait, three-quarter view, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, pink inner highlights, thin glasses, santa hat, red bikini strap, pink lipstick, masterpiece, best quality",
    3: "aurelia_char, 1girl, close-up portrait, smirking, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, large hoop earrings, expressive face, masterpiece, best quality",
    4: "aurelia_char, 1girl, full body, standing, low angle shot, short hair, black hair with purple gradient, high ponytail, hair over left eye, thin glasses, red bikini, string bikini, thighhighs, santa hat, elbow gloves, bathroom, masterpiece, best quality",
    7: "aurelia_char, 1girl, wide shot, landscape composition, looking at viewer, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, neon city, night, futuristic cityscape, atmospheric lighting, masterpiece, best quality",
    8: "aurelia_char, 1girl, wide shot, landscape composition, seated pose, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, cinematic lighting, scenic background, masterpiece, best quality",
    9: "aurelia_char, 1girl, wide shot, profile angle, looking over shoulder, short hair, black hair with purple gradient, high ponytail, side bangs, back hair view, evening sky, city lights, masterpiece, best quality",
    10: "aurelia_char, 1girl, cowboy shot, frontal torso, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, open streetwear jacket, crop top, navel piercing, idol outfit, masterpiece, best quality",
    11: "aurelia_char, 1girl, cowboy shot, neutral expression, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, crop top, streetwear, crisp lines, masterpiece, best quality",
    12: "aurelia_char, 1girl, cowboy shot, rim lighting, vibrant purple tips, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, studio lighting, masterpiece, best quality",
    13: "aurelia_char, 1girl, cowboy shot, head tilt, direct eye contact, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, stylish outfit, masterpiece, best quality",
    14: "aurelia_char, 1girl, cowboy shot, gentle smile, casual streetwear jacket, collar, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, masterpiece, best quality",
    15: "aurelia_char, 1girl, cowboy shot, torso turnaround, back gradient layers, short hair, black hair with purple gradient, high ponytail, hair volume, stylish top, masterpiece, best quality",
    16: "aurelia_char, 1girl, cowboy shot, ultra high resolution, detailed irises, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, red bikini top, fur trim, collarbone, necklace, bathroom, masterpiece, best quality",
    18: "aurelia_char, 1girl, cowboy shot, expressive hand gesture, hand raised, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, hoop earrings, red bikini, santa hat, bathroom, masterpiece, best quality",
    20: "aurelia_char, 1girl, cowboy shot, ultra high resolution, clean strand separation, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, red bikini, santa hat, lace gloves, bathroom sink, masterpiece, best quality",
    24: "aurelia_char, 1girl, cowboy shot, upward perspective, looking slightly up, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, mole under left eye, thin glasses, red bikini, santa hat, bathroom, masterpiece, best quality",
    25: "aurelia_char, 1girl, cowboy shot, relaxed natural pose, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, thin glasses, red bikini, santa hat, bathroom, masterpiece, best quality"
}

images_by_num = {img["number"]: img for img in manifest["images"]}
prepared_summary = []

for num in selected_numbers:
    img_meta = images_by_num[num]
    src_path = img_meta["path"]
    orig_name = img_meta["filename"]

    # Target filenames in dataset dir: e.g. aurelia_01.png and aurelia_01.txt
    base_name = f"aurelia_{num:02d}"
    dst_img_path = os.path.join(train_dataset_dir, f"{base_name}.png")
    dst_txt_path = os.path.join(train_dataset_dir, f"{base_name}.txt")

    shutil.copy2(src_path, dst_img_path)

    caption = caption_overrides.get(num, f"aurelia_char, 1girl, short hair, black hair with purple gradient, high ponytail, hair over left eye, warm brown eyes, masterpiece, best quality")
    with open(dst_txt_path, "w", encoding="utf-8") as f:
        f.write(caption)

    with Image.open(dst_img_path) as im:
        w, h = im.size

    prepared_summary.append({
        "num": num,
        "base_name": base_name,
        "orig_filename": orig_name,
        "width": w,
        "height": h,
        "aspect_ratio": round(w / h, 3),
        "caption": caption
    })

print(f"Successfully prepared {len(prepared_summary)} images and paired .txt captions in:")
print(f"  {train_dataset_dir}")

# Save training dataset summary
with open(os.path.join(train_dataset_dir, "dataset_summary.json"), "w", encoding="utf-8") as f:
    json.dump(prepared_summary, f, indent=2)

print("\nDataset preparation verified! Sample items:")
for s in prepared_summary[:3]:
    print(f"  [{s['base_name']}] ({s['width']}x{s['height']}): {s['caption'][:80]}...")
