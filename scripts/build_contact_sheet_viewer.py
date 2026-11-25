import base64
import os

brain_dir = r"C:\Users\Harris\.gemini\antigravity\brain\489779a3-e857-4bc4-accf-9207845b6d60"

with open(os.path.join(brain_dir, "aurelia_selected_13_contact_sheet_preview.webp"), "rb") as f:
    b64_13 = base64.b64encode(f.read()).decode("utf-8")

with open(os.path.join(brain_dir, "aurelia_full_25_contact_sheet_preview.webp"), "rb") as f:
    b64_25 = base64.b64encode(f.read()).decode("utf-8")

html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    .zoom-container {{
      overflow: auto;
      max-height: 600px;
      border: 1px solid #333846;
      border-radius: 8px;
      background: #0d0e12;
    }}
    .zoom-img {{
      width: 100%;
      height: auto;
      display: block;
      cursor: zoom-in;
      transition: width 0.2s ease;
    }}
    .zoomed {{
      width: 200%;
      max-width: none;
      cursor: zoom-out;
    }}
  </style>
</head>
<body class="bg-transparent text-slate-100 antialiased p-0 m-0">
  <div class="py-2 space-y-3 font-sans">
    <!-- Header Controls -->
    <div class="flex items-center justify-between gap-4 pb-2 border-b border-slate-700 text-xs">
      <div class="flex items-center gap-2">
        <button id="tab13Btn" onclick="switchTab('13')" class="px-3 py-1.5 rounded font-semibold bg-emerald-600 text-white transition-colors">
          Selected 13 Images (Option A)
        </button>
        <button id="tab25Btn" onclick="switchTab('25')" class="px-3 py-1.5 rounded font-medium bg-slate-800 text-slate-400 hover:text-white transition-colors">
          Full 25 Candidates (Audit Matrix)
        </button>
      </div>
      <div class="flex items-center gap-3 text-xs text-slate-400">
        <span>Click image to toggle 2x zoom</span>
        <button onclick="resetZoom()" class="px-2 py-1 bg-slate-800 rounded border border-slate-700 text-xs hover:bg-slate-700 text-slate-300">
          Reset View
        </button>
      </div>
    </div>

    <!-- Tab 1: Selected 13 -->
    <div id="tab13" class="space-y-2">
      <div class="flex items-center justify-between text-xs px-1 text-slate-400">
        <span class="font-medium text-emerald-400">13 Approved Images (77% Streetwear/Landscape, 23% Santa Bikini)</span>
        <span>Resolution Range: 896x1344 to 1472x832</span>
      </div>
      <div class="zoom-container">
        <img id="img13" src="data:image/webp;base64,{b64_13}" alt="Aurelia 13 Selected Contact Sheet" class="zoom-img" onclick="toggleZoom(this)" />
      </div>
    </div>

    <!-- Tab 2: Full 25 -->
    <div id="tab25" class="space-y-2 hidden">
      <div class="flex items-center justify-between text-xs px-1 text-slate-400">
        <span class="font-medium text-amber-400">Full 25 Candidates (13 Selected in Green, 12 Excluded in Red)</span>
        <span>2 Artifacts Excluded (#05, #06) + 10 Santa Duplicates Pruned</span>
      </div>
      <div class="zoom-container">
        <img id="img25" src="data:image/webp;base64,{b64_25}" alt="Aurelia Full 25 Candidate Audit Sheet" class="zoom-img" onclick="toggleZoom(this)" />
      </div>
    </div>
  </div>

  <script>
    function switchTab(tab) {{
      const tab13 = document.getElementById('tab13');
      const tab25 = document.getElementById('tab25');
      const btn13 = document.getElementById('tab13Btn');
      const btn25 = document.getElementById('tab25Btn');

      resetZoom();
      if (tab === '13') {{
        tab13.classList.remove('hidden');
        tab25.classList.add('hidden');
        btn13.className = 'px-3 py-1.5 rounded font-semibold bg-emerald-600 text-white transition-colors';
        btn25.className = 'px-3 py-1.5 rounded font-medium bg-slate-800 text-slate-400 hover:text-white transition-colors';
      }} else {{
        tab13.classList.add('hidden');
        tab25.classList.remove('hidden');
        btn25.className = 'px-3 py-1.5 rounded font-semibold bg-amber-600 text-white transition-colors';
        btn13.className = 'px-3 py-1.5 rounded font-medium bg-slate-800 text-slate-400 hover:text-white transition-colors';
      }}
    }}

    function toggleZoom(img) {{
      img.classList.toggle('zoomed');
    }}

    function resetZoom() {{
      const img13 = document.getElementById('img13');
      const img25 = document.getElementById('img25');
      if (img13) img13.classList.remove('zoomed');
      if (img25) img25.classList.remove('zoomed');
    }}
  </script>
</body>
</html>"""

out_path = os.path.join(brain_dir, "aurelia_contact_sheet_viewer.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"Generated standalone interactive viewer: {out_path} ({os.path.getsize(out_path) // 1024} KB)")
