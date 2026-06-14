import os
import shutil
import zipfile

def create_zip():
    dist_dir = "dist_crazygames"
    zip_name = "dead_number_crazygames.zip"
    
    # 1. Clean up old dist directory if it exists
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir)
    
    # Create subfolders
    os.makedirs(os.path.join(dist_dir, "css"))
    os.makedirs(os.path.join(dist_dir, "js"))
    os.makedirs(os.path.join(dist_dir, "assets"))
    
    # 2. Copy files
    # Rename dead_number.html to index.html for CrazyGames compatibility
    shutil.copy("dead_number.html", os.path.join(dist_dir, "index.html"))
    shutil.copy(os.path.join("css", "dead_number.css"), os.path.join(dist_dir, "css", "dead_number.css"))
    shutil.copy(os.path.join("js", "dead_number.obfuscated.js"), os.path.join(dist_dir, "js", "dead_number.obfuscated.js"))
    
    logo_src = os.path.join("assets", "zaesar_logo.png")
    if os.path.exists(logo_src):
        shutil.copy(logo_src, os.path.join(dist_dir, "assets", "zaesar_logo.png"))
    else:
        print("Warning: assets/zaesar_logo.png not found!")

    # 3. Create ZIP archive
    if os.path.exists(zip_name):
        os.remove(zip_name)
        
    with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # Keep archive path relative to the dist_dir
                arc_path = os.path.relpath(file_path, dist_dir)
                zipf.write(file_path, arc_path)
                
    # 4. Clean up temp directory
    shutil.rmtree(dist_dir)
    
    print(f"SUCCESS: Created game zip archive ready for upload:")
    print(f"  Archive: {os.path.abspath(zip_name)}")
    print("  Contains: index.html, css/dead_number.css, js/dead_number.obfuscated.js, assets/zaesar_logo.png")

if __name__ == "__main__":
    create_zip()
