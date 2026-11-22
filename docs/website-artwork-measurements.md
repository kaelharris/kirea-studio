# KIREA Studio website artwork measurements

Measured the built marketing page at http://127.0.0.1:4173/ in Chrome via Playwright. Fonts were ready and each image decoded before its bounds were recorded. The five sizes are CSS viewports. Tables show frame bounds in CSS pixels and the width divided by the height to six decimals. The [manifest](./website-artwork-manifest.json) keeps the unrounded frame and image rectangles, computed fitting and positioning, loaded file dimensions and exact byte counts.

The desktop studio measurements sample the active card near the front of the orbit. The cards are scaled continuously as they rotate. Tablet and phone use the stacked stage. The lightbox is measured open with the genuine Create screen. Open Graph and Twitter share the existing 1200 × 630 JPEG, which has no rendered slot.

## Baseline frames

| Placement | Image / frame selector | 1920 × 1080 | 1440 × 900 | 768 × 1024 | 390 × 844 | 375 × 812 |
| --- | --- | --- | --- | --- | --- | --- |
| Header logo | `.brand__mark` | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) |
| Hero | `.hero__art`<br>`.hero__stage` | 1920 × 1080 (1.777778) | 1440 × 900 (1.600000) | 768 × 1037.3125 (0.740375) | 390 × 881.46875 (0.442443) | 375 × 870.34375 (0.430864) |
| Hero · Create screenshot | `.app-window--hero img`<br>`.app-window--hero` | 499.448486 × 356.230591 (1.402037) | 490.048462 × 350.70813 (1.397311) | 691.21875 × 472.90625 (1.461640) | 346 × 270.09375 (1.281037) | 331 × 261.28125 (1.266834) |
| Shared screenshot lightbox (measured with Create) | `[data-lightbox-image]`<br>`[data-lightbox]` | 1520 × 886.203125 (1.715182) | 1353.59375 × 745.8125 (1.814925) | 721.90625 × 466.75 (1.546666) | 366.59375 × 275.8125 (1.329141) | 352.5 × 267.53125 (1.317603) |
| Studio · Image Studio | `.world:nth-child(1) img`<br>`.world:nth-child(1) .world__art` | 257.600037 × 322 (0.800000) | 241.919983 × 302.400024 (0.800000) | 245.75 × 307.1875 (0.800000) | 202.546875 × 253.171875 (0.800037) | 194.875 × 243.59375 (0.800000) |
| Studio · Video Studio | `.world:nth-child(2) img`<br>`.world:nth-child(2) .world__art` | 257.600037 × 171.727509 (1.500051) | 241.919983 × 161.279999 (1.500000) | 460.78125 × 307.1875 (1.500000) | 280.796875 × 187.1875 (1.500083) | 270 × 180 (1.500000) |
| Studio · Model Hub | `.world:nth-child(3) img`<br>`.world:nth-child(3) .world__art` | 257.600037 × 257.600006 (1.000000) | 241.919983 × 241.920013 (1.000000) | 307.1875 × 307.1875 (1.000000) | 253.1875 × 253.1875 (1.000000) | 243.59375 × 243.59375 (1.000000) |
| Studio · Workflow Management | `.world:nth-child(4) img`<br>`.world:nth-child(4) .world__art` | 257.600037 × 193.199982 (1.333334) | 241.919983 × 181.440002 (1.333333) | 409.578125 × 307.171875 (1.333384) | 280.796875 × 210.59375 (1.333358) | 270 × 202.5 (1.333333) |
| Studio · Character & Animation | `.world:nth-child(5) img`<br>`.world:nth-child(5) .world__art` | 257.599976 × 177.642487 (1.450103) | 241.919983 × 166.827515 (1.450120) | 445.421875 × 307.1875 (1.450000) | 280.796875 × 193.640625 (1.450093) | 270 × 186.203125 (1.450029) |
| Studio · Pixel Studio | `.world:nth-child(6) img`<br>`.world:nth-child(6) .world__art` | 257.599976 × 257.599976 (1.000000) | 241.919983 × 241.919998 (1.000000) | 307.1875 × 307.1875 (1.000000) | 253.1875 × 253.1875 (1.000000) | 243.59375 × 243.59375 (1.000000) |
| Studio hub · Home screenshot | `.app-window--hub img`<br>`.app-window--hub` | 760 × 513.3125 (1.480580) | 604.796875 × 422.140625 (1.432691) | 660.46875 × 454.84375 (1.452078) | 335.390625 × 263.859375 (1.271096) | 322.5 × 256.28125 (1.258383) |
| Showcase · Home | `[data-showcase-image="home"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Showcase · Create | `[data-showcase-image="create"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Showcase · Models | `[data-showcase-image="models"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Showcase · Workflows | `[data-showcase-image="workflows"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Showcase · Explore | `[data-showcase-image="explore"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Showcase · Light theme | `[data-showcase-image="light"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 421.84375 × 247.828125 (1.702163) | 421.84375 × 247.828125 (1.702163) |
| Local-first | `.local__frame img`<br>`.local__frame` | 719.1875 × 700 (1.027411) | 709.90625 × 666 (1.065925) | 768 × 1024 (0.750000) | 390 × 844 (0.462085) | 375 × 812 (0.461823) |
| Final download | `.close__art`<br>`.close__stage` | 1920 × 1080 (1.777778) | 1440 × 900 (1.600000) | 768 × 1024 (0.750000) | 390 × 844 (0.462085) | 375 × 812 (0.461823) |

## Original sources and fitting

| Placement | Loaded original files and native size at DPR 1 | Fit / object position | Focal and responsive direction |
| --- | --- | --- | --- |
| Header logo | kirea-mark-nAFZ2eS1.svg · 1028 × 1028 | fill / 50% 50% | Centered vector identity mark. |
| Hero | hero-living-world-2400-B0Ho32a3.webp · 2400 × 1013<br>hero-living-world-1200-Be1XFUbT.webp · 1200 × 506 | cover / 55% 48%<br>cover / 72% 45% | Muse face and fluted opal canopy read above the desktop preview. Quiet copy area at left. Tablet and phone use individually composed images with the face in the open area at right. |
| Hero · Create screenshot | create-dark-jkG7f2tU.webp · 1600 × 940 | fill / 50% 50% | Whole Create screen inside the existing app window. CSS height is auto. |
| Shared screenshot lightbox (measured with Create) | create-dark-jkG7f2tU.webp · 1600 × 940 | contain / 50% 50% | Contain and center the active genuine application screenshot. Measurements use Create. |
| Studio · Image Studio | image-studio-v2-640-BMQTwt7s.webp · 640 × 800 | cover / 50% 50% | Muse and pigment press grouped in center. Keep the making gesture inside the shared 4:3 frame. |
| Studio · Video Studio | video-studio-v2-900-CD63-T5y.webp · 900 × 600 | cover / 50% 50% | Muse framed by the rolling wind tunnel and flowing material. Protect her face from the crop. |
| Studio · Model Hub | model-hub-v2-640-CfvGUo0C.webp · 640 × 640 | cover / 50% 50% | Central open cabinet and the strongest object silhouettes in the safe middle of the card. |
| Studio · Workflow Management | workflow-garden-640-CfYSCH2X.webp · 640 × 480 | cover / 50% 50% | One continuous abstract paper structure and the connections between folds. Keep all intersections legible. |
| Studio · Character & Animation | character-cast-760-CMOFxHNx.webp · 760 × 524 | cover / 50% 50% | Muse at the center of the cast. Keep the cast silhouettes and facial landmarks inside the card. |
| Studio · Pixel Studio | pixel-island-640-DD6QmIEn.webp · 640 × 640 | cover / 50% 50% | Muse sprite and greenhouse grouped closely in the interior, fully inside the card. Keep an integer pixel scale in the WebP encodes. |
| Studio hub · Home screenshot | home-light-C8OuQf29.webp · 1600 × 940 | fill / 50% 50% | Whole Home screen within the existing app window. CSS height is auto. |
| Showcase · Home | home-dark-Xd0WVp9w.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Showcase · Create | create-dark-jkG7f2tU.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Showcase · Models | models-dark-CmZnYNLU.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Showcase · Workflows | workflows-dark-DmQlh4-F.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Showcase · Explore | explore-dark-CYy4bxlK.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Showcase · Light theme | create-light-CHxKDCV0.webp · 1600 × 940 | cover / 50% 50% | Centered genuine application screenshot. |
| Local-first | local-studio-1200-Cnit_wXw.webp · 1200 × 900<br>local-studio-900-D9ra5i6c.webp · 900 × 675 | cover / 78% 50%<br>cover / 68% 50% | Near the right or lower frame, a real-feeling workspace in late light. The portrait places the desk below the copy and the tall window to the right. |
| Final download | hand-orb-1000-CMZI6eAV.webp · 1000 × 600 | cover / 42% 50%<br>cover / 35% 50% | Quiet left third for the CTA, opening on the right. The portrait places the fluted aperture in the exposed band below the download card. |

## Production dimensions

The shared studio frame uses the existing Workflow ratio of **4:3**. The artwork width in the stacked stage is capped at 280 CSS pixels to fit between the heading and the Home window. The orbit, stage and copy retain their existing positions. The product previews, six showcase tabs and the lightbox use the original 1600 × 940 assets.

The hero has separate desktop, tablet and phone masters. The atelier and gateway each have desktop and portrait masters. The browser chooses the closer frame at each breakpoint. Integer encodes approximate fractional CSS dimensions, and object-fit cover absorbs small differences between adjacent viewport sizes. Alt text describes the individual illustrations where the artwork is content.

| Placement | Variant | 1× target | 2× target | Aspect ratio |
| --- | --- | --- | --- | --- |
| Hero | desktop wide | 1920 × 1080 | 3840 × 2160 | 1.777778 |
| Hero | desktop | 1440 × 900 | 2880 × 1800 | 1.600000 |
| Hero | tablet | 768 × 1037 | 1536 × 2074 | 0.740598 |
| Hero | phone | 390 × 881 | 780 × 1762 | 0.442679 |
| Studio · Image Studio | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Studio · Video Studio | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Studio · Model Hub | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Studio · Workflow Management | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Studio · Character & Animation | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Studio · Pixel Studio | shared desktop/tablet/phone | 320 × 240 | 640 × 480 | 1.333333 |
| Local-first | desktop wide | 719 × 700 | 1438 × 1400 | 1.027143 |
| Local-first | desktop | 710 × 666 | 1420 × 1332 | 1.066066 |
| Local-first | tablet | 768 × 1024 | 1536 × 2048 | 0.750000 |
| Local-first | phone | 390 × 844 | 780 × 1688 | 0.462085 |
| Final download | desktop wide | 1920 × 1080 | 3840 × 2160 | 1.777778 |
| Final download | desktop | 1440 × 900 | 2880 × 1800 | 1.600000 |
| Final download | tablet | 768 × 1024 | 1536 × 2048 | 0.750000 |
| Final download | phone | 390 × 844 | 780 × 1688 | 0.462085 |

## Integrated frames

| Placement | Image / frame selector | 1920 × 1080 | 1440 × 900 | 768 × 1024 | 390 × 844 | 375 × 812 |
| --- | --- | --- | --- | --- | --- | --- |
| Header logo | `.brand__mark` | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) | 26 × 26 (1.000000) |
| Hero | `.hero__art`<br>`.hero__stage` | 1920 × 1080 (1.777778) | 1440 × 900 (1.600000) | 768 × 1037.3125 (0.740375) | 390 × 881.46875 (0.442443) | 375 × 870.34375 (0.430864) |
| Hero · Create screenshot | `.app-window--hero img`<br>`.app-window--hero` | 499.448486 × 356.230591 (1.402037) | 490.048462 × 350.70813 (1.397311) | 691.21875 × 472.90625 (1.461640) | 346 × 270.09375 (1.281037) | 331 × 261.28125 (1.266834) |
| Shared screenshot lightbox (measured with Create) | `[data-lightbox-image]`<br>`[data-lightbox]` | 1520 × 886.203125 (1.715182) | 1353.59375 × 745.8125 (1.814925) | 721.90625 × 466.75 (1.546666) | 366.59375 × 275.8125 (1.329141) | 352.5 × 267.53125 (1.317603) |
| Studio · Image Studio | `.world:nth-child(1) img`<br>`.world:nth-child(1) .world__art` | 257.600037 × 193.200012 (1.333333) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio · Video Studio | `.world:nth-child(2) img`<br>`.world:nth-child(2) .world__art` | 257.600037 × 193.199982 (1.333334) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio · Model Hub | `.world:nth-child(3) img`<br>`.world:nth-child(3) .world__art` | 257.600037 × 193.199982 (1.333334) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio · Workflow Management | `.world:nth-child(4) img`<br>`.world:nth-child(4) .world__art` | 257.600037 × 193.199982 (1.333334) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio · Character & Animation | `.world:nth-child(5) img`<br>`.world:nth-child(5) .world__art` | 257.599976 × 193.199982 (1.333333) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio · Pixel Studio | `.world:nth-child(6) img`<br>`.world:nth-child(6) .world__art` | 257.599976 × 193.200012 (1.333333) | 241.919983 × 181.440002 (1.333333) | 280 × 210 (1.333333) | 280 × 210 (1.333333) | 270 × 202.5 (1.333333) |
| Studio hub · Home screenshot | `.app-window--hub img`<br>`.app-window--hub` | 760 × 513.3125 (1.480580) | 604.796875 × 422.140625 (1.432691) | 660.46875 × 454.84375 (1.452078) | 335.390625 × 263.859375 (1.271096) | 322.5 × 256.28125 (1.258383) |
| Showcase · Home | `[data-showcase-image="home"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Showcase · Create | `[data-showcase-image="create"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Showcase · Models | `[data-showcase-image="models"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Showcase · Workflows | `[data-showcase-image="workflows"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Showcase · Explore | `[data-showcase-image="explore"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Showcase · Light theme | `[data-showcase-image="light"]`<br>`.showcase__stack` | 1178 × 692.0625 (1.702158) | 905.1875 × 531.796875 (1.702130) | 689.21875 × 404.90625 (1.702169) | 344 × 202.09375 (1.702180) | 329 × 193.28125 (1.702183) |
| Local-first | `.local__frame img`<br>`.local__frame` | 719.1875 × 700 (1.027411) | 709.90625 × 666 (1.065925) | 768 × 1024 (0.750000) | 390 × 844 (0.462085) | 375 × 812 (0.461823) |
| Final download | `.close__art`<br>`.close__stage` | 1920 × 1080 (1.777778) | 1440 × 900 (1.600000) | 768 × 1024 (0.750000) | 390 × 844 (0.462085) | 375 × 812 (0.461823) |

## Delivered files

Full quality PNG masters are stored in `vibe_images/kirea-mixed-masters/`. The [manifest](./website-artwork-manifest.json) includes the generation prompts, crop rectangles and file metadata. The site uses WebP encodes from `site/assets/art/`. Encodes are capped at the native master dimensions, with a whole-pixel approximation where the CSS ratio is fractional. Nearby small and large candidates share the larger file. The 640-pixel Pixel Studio rendition uses integer scaling from the lossless 320-pixel grid.

| Artwork master | Native resolution | PNG bytes |
| --- | --- | ---: |
| hero.png | 1672 × 941 | 2,216,277 |
| hero-tablet.png | 1086 × 1448 | 2,278,939 |
| hero-phone.png | 834 × 1885 | 1,667,149 |
| creation.png | 1448 × 1086 | 3,470,260 |
| motion.png | 1448 × 1086 | 2,656,426 |
| cabinet.png | 1448 × 1086 | 3,564,729 |
| connections.png | 1448 × 1086 | 2,433,143 |
| cast.png | 1448 × 1086 | 2,807,887 |
| pixel.png | 1448 × 1086 | 2,618,699 |
| atelier.png | 1254 × 1254 | 2,226,992 |
| atelier-portrait.png | 1086 × 1448 | 2,470,879 |
| gateway.png | 1672 × 941 | 2,199,313 |
| gateway-portrait.png | 1086 × 1448 | 1,854,608 |

| Web file | Resolution | WebP bytes |
| --- | --- | ---: |
| kirea-hero-wide-1664.webp | 1664 × 936 | 127,694 |
| kirea-hero-desktop-1504.webp | 1504 × 940 | 121,998 |
| kirea-hero-tablet-768.webp | 768 × 1037 | 107,724 |
| kirea-hero-tablet-1072.webp | 1072 × 1448 | 179,140 |
| kirea-hero-phone-390.webp | 390 × 881 | 18,522 |
| kirea-hero-phone-780.webp | 780 × 1762 | 50,914 |
| kirea-creation-320.webp | 320 × 240 | 32,182 |
| kirea-creation-640.webp | 640 × 480 | 120,654 |
| kirea-motion-320.webp | 320 × 240 | 25,602 |
| kirea-motion-640.webp | 640 × 480 | 80,798 |
| kirea-cabinet-320.webp | 320 × 240 | 25,210 |
| kirea-cabinet-640.webp | 640 × 480 | 96,678 |
| kirea-connections-320.webp | 320 × 240 | 6,080 |
| kirea-connections-640.webp | 640 × 480 | 20,232 |
| kirea-cast-320.webp | 320 × 240 | 24,228 |
| kirea-cast-640.webp | 640 × 480 | 81,012 |
| kirea-pixel-320.webp | 320 × 240 | 167,068 |
| kirea-pixel-640.webp | 640 × 480 | 192,670 |
| kirea-local-wide-719.webp | 719 × 700 | 87,242 |
| kirea-local-wide-1254.webp | 1254 × 1221 | 153,708 |
| kirea-local-desktop-710.webp | 710 × 666 | 83,296 |
| kirea-local-desktop-1254.webp | 1254 × 1176 | 150,706 |
| kirea-local-tablet-768.webp | 768 × 1024 | 136,980 |
| kirea-local-tablet-1086.webp | 1086 × 1448 | 223,898 |
| kirea-local-phone-390.webp | 390 × 844 | 63,218 |
| kirea-local-phone-669.webp | 669 × 1448 | 140,574 |
| kirea-gateway-wide-1664.webp | 1664 × 936 | 75,238 |
| kirea-gateway-desktop-1504.webp | 1504 × 940 | 71,140 |
| kirea-gateway-tablet-768.webp | 768 × 1024 | 24,494 |
| kirea-gateway-tablet-1086.webp | 1086 × 1448 | 42,972 |
| kirea-gateway-phone-390.webp | 390 × 844 | 14,810 |
| kirea-gateway-phone-669.webp | 669 × 1448 | 36,282 |

## Browser validation

| Viewport | Decoded placements | Run errors | Baseline image bytes | Final image bytes | Layout shift entries |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1920 × 1080 | 19 | 0 | 1,948,494 | 1,193,840 | 0 |
| 1440 × 900 | 19 | 0 | 1,883,840 | 1,180,100 | 0 |
| 768 × 1024 | 19 | 0 | 1,711,042 | 1,172,864 | 0 |
| 390 × 844 | 19 | 0 | 1,711,042 | 1,000,216 | 0 |
| 375 × 812 | 19 | 0 | 1,711,042 | 1,000,216 | 0 |

Image bytes are the encoded resource bytes recorded by Chrome for the page and scripted visit through all six showcase states. Counts describe the local preview.

The same five viewports also passed at device pixel ratio 2. The site loaded 320 × 240 studio files at DPR 1 and 640 × 480 files at DPR 2. Both sizes are 4:3. There were zero browser errors and zero layout shift entries in all ten runs.

| Viewport | DPR 1 image bytes | DPR 2 image bytes |
| --- | ---: | ---: |
| 1920 × 1080 | 1,193,840 | 1,571,980 |
| 1440 × 900 | 1,180,100 | 1,559,184 |
| 768 × 1024 | 1,172,864 | 1,661,350 |
| 390 × 844 | 1,000,216 | 1,443,110 |
| 375 × 812 | 1,000,216 | 1,443,110 |

Chrome verified all five studio switches at every size and confirmed fixed showcase bounds across all six screenshots. The hero and reserved artwork frames kept their geometry through a deliberately held image request. The section menu, Escape dismissal, product screenshot dialog, showcase tabs and GPU profile switch passed. Existing product artwork and screenshot requests matched the baseline URLs and byte counts.

## Integration and builds

- [Landing markup](../site/index.html) selects the responsive hero, atelier and gateway crops and contains the six studio scenes.
- [Site styles](../site/styles.css) define the stable 4:3 card, reserve space for the showcase caption and keep phone screenshots within the viewport.
- [Playwright harness](../scrollcraft/builds/kirea-studio/lab/measure-artwork.mjs) captures all 19 placements and checks image loading, geometry and controls.
- Site build and Electron build passed. Existing Vitest suite passed with local loopback and temporary filesystem access. 396 passed and 11 skipped.

Desktop panoramas start from native 1672 × 941 masters. The strongest available resolution was retained, below native 2× at 1920 × 1080. The phone hero reaches the 2× target. Final render checks used Chrome emulation.
