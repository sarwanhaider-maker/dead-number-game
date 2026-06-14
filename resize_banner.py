import os
from PIL import Image

def resize_images():
    brain_dir = r"C:\Users\Lenovo\.gemini\antigravity\brain\a4578604-2ee1-4525-a117-183a01a6ee3e"
    
    targets = [
        {
            "src": "dead_number_banner_1781433571365.png",
            "prefix": "dead_number"
        },
        {
            "src": "thinking_numbers_art_1781433754072.png",
            "prefix": "thinking_numbers"
        }
    ]
    
    dimensions = {
        "16_9": (1920, 1080),
        "2_3": (800, 1200),
        "1_1": (800, 800)
    }
    
    for t in targets:
        src_path = os.path.join(brain_dir, t["src"])
        if not os.path.exists(src_path):
            print(f"Error: Source file {src_path} not found!")
            continue
            
        print(f"Processing {t['src']}...")
        with Image.open(src_path) as img:
            for suffix, dims in dimensions.items():
                out_name = f"{t['prefix']}_{suffix}.png"
                out_path = os.path.join(brain_dir, out_name)
                
                # Resize image (using Lanczos filter for high quality resizing)
                resized = img.resize(dims, Image.Resampling.LANCZOS)
                resized.save(out_path, "PNG")
                print(f"  Saved: {out_path} ({dims[0]}x{dims[1]})")

if __name__ == "__main__":
    resize_images()
