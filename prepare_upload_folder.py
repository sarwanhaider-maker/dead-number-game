import os
import shutil

def prepare_folder():
    target_dir = "dead_number_upload"
    
    # 1. Clean up old target directory if it exists
    if os.path.exists(target_dir):
        shutil.rmtree(target_dir)
    os.makedirs(target_dir)
    
    # Create subfolders
    os.makedirs(os.path.join(target_dir, "css"))
    os.makedirs(os.path.join(target_dir, "js"))
    os.makedirs(os.path.join(target_dir, "assets"))
    
    # 2. Copy files and rename dead_number.html to index.html
    shutil.copy("dead_number.html", os.path.join(target_dir, "index.html"))
    shutil.copy(os.path.join("css", "dead_number.css"), os.path.join(target_dir, "css", "dead_number.css"))
    shutil.copy(os.path.join("js", "dead_number.obfuscated.js"), os.path.join(target_dir, "js", "dead_number.obfuscated.js"))
    
    logo_src = os.path.join("assets", "zaesar_logo.png")
    if os.path.exists(logo_src):
        shutil.copy(logo_src, os.path.join(target_dir, "assets", "zaesar_logo.png"))
        
    print(f"SUCCESS: Prepared upload folder at:")
    print(f"  {os.path.abspath(target_dir)}")
    print("  Contains: index.html, css/dead_number.css, js/dead_number.obfuscated.js, assets/zaesar_logo.png")

if __name__ == "__main__":
    prepare_folder()
