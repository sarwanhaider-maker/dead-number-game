# ==============================================================================
# Dead Number: Frontend Code Protection & Obfuscator Compilation Utility
#
# PURPOSE:
#   Encrypts and obfuscates 'js/dead_number.js' into a self-decrypting runtime 
#   bundle 'js/dead_number.obfuscated.js'. This helps secure your game mechanics,
#   bot parameters, and custom economy features from clear-text inspection.
#
# HOW IT WORKS:
#   1. Reads the clean source JavaScript code as raw binary bytes.
#   2. Generates a random multi-byte key (8 to 16 bytes).
#   3. Encrypts the source code byte-by-byte using XOR logic with the dynamic key.
#      (Byte-level encryption safely supports UTF-8, emojis, and local symbols).
#   4. Packs both the encrypted payload and the key into Base64 format.
#   5. Embeds them into a self-decrypting loader that executes dynamically in
#      the browser using eval() and TextDecoder.
#
# RUNNING THIS SCRIPT:
#   Run the following command in the workspace directory to compile:
#       python obfuscate.py
# ==============================================================================

import base64
import os
import random

def main():
    js_path = os.path.join("js", "dead_number.js")
    output_path = os.path.join("js", "dead_number.obfuscated.js")
    
    if not os.path.exists(js_path):
        print(f"Error: {js_path} not found.")
        return

    # Read the clean JavaScript source file as bytes
    with open(js_path, "rb") as f:
        code_bytes = f.read()

    # Generate random encryption key bytes
    key_length = random.randint(8, 16)
    key_bytes = bytes(random.randint(1, 255) for _ in range(key_length))

    # Perform XOR encryption byte-by-byte (handles emojis & UTF-8 characters safely)
    encrypted_bytes = bytes(b ^ key_bytes[i % len(key_bytes)] for i, b in enumerate(code_bytes))

    # Base64 encode the key and the encrypted payload
    enc_b64 = base64.b64encode(encrypted_bytes).decode('utf-8')
    key_b64 = base64.b64encode(key_bytes).decode('utf-8')

    # Obfuscated loader function that decrypts and executes the game dynamically
    # Variables use minified hex representation to hinder trivial static string analyzers
    loader = (
        f'(function(_0x1b2c,_0x3d4e){{'
        f'var _0x5f6a=atob(_0x1b2c);'
        f'var _0x7b8c=atob(_0x3d4e);'
        f'var _0x9d0e=new Uint8Array(_0x5f6a.length);'
        f'for(var i=0;i<_0x5f6a.length;i++){{'
        f'_0x9d0e[i]=_0x5f6a.charCodeAt(i)^_0x7b8c.charCodeAt(i%_0x7b8c.length);'
        f'}}'
        f'eval(new TextDecoder("utf-8").decode(_0x9d0e));'
        f'}})("{enc_b64}","{key_b64}");'
    )

    # Write the compiled version
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(loader)

    print(f"Successfully encrypted & obfuscated:")
    print(f"  Source: {js_path}")
    print(f"  Output: {output_path}")

if __name__ == "__main__":
    main()
