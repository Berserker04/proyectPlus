from PIL import Image
import sys

def resize_and_pad(img_path, target_size=1024, output_path=None):
    img = Image.open(img_path).convert("RGBA")
    
    # Calculate the ratio
    ratio = min(target_size / img.width, target_size / img.height)
    new_size = (int(img.width * ratio), int(img.height * ratio))
    
    # Resize the image
    img = img.resize(new_size, Image.Resampling.LANCZOS)
    
    # Create a new square image with transparent background
    new_img = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    
    # Paste the resized image into the center of the new image
    paste_pos = ((target_size - new_size[0]) // 2, (target_size - new_size[1]) // 2)
    new_img.paste(img, paste_pos)
    
    if output_path is None:
        output_path = img_path
        
    new_img.save(output_path)

if __name__ == "__main__":
    input_file = sys.argv[1] if len(sys.argv) > 1 else "app-icon.png"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "app-icon-1024.png"
    resize_and_pad(input_file, 1024, output_file)
    print(f"Resized {input_file} to 1024x1024 and saved as {output_file}")
