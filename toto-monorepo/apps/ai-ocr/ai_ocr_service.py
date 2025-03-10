from fastapi import FastAPI, UploadFile, File
import easyocr
import numpy as np
import cv2
import uvicorn
import os

app = FastAPI()

# Load OCR model
reader = easyocr.Reader(['en'])

def detect_layout(image):
    """Detects text regions, bubbles, and layout elements."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Edge detection
    edges = cv2.Canny(blurred, 50, 150)

    # Find contours (bubbles, text areas)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Get bounding boxes
    bounding_boxes = [cv2.boundingRect(c) for c in contours]
    bounding_boxes = sorted(bounding_boxes, key=lambda x: x[1])  # Sort by Y position

    return bounding_boxes

@app.post("/convert-to-html")
async def convert_image_to_html(file: UploadFile = File(...)):
    # Read image file
    image_bytes = await file.read()
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # Detect layout elements (bubbles, text areas)
    elements = detect_layout(image)

    # Generate HTML structure
    html_structure = """
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; background: white; position: relative; }
            .container { width: 100%; max-width: 600px; margin: auto; position: relative; }
            .element { position: absolute; background: rgba(211, 211, 211, 0.5); padding: 5px; border-radius: 5px; }
            .text { position: absolute; font-size: 16px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class='container'>
    """

    extracted_data = []
    for i, (x, y, w, h) in enumerate(elements):
        roi = image[y:y+h, x:x+w]

        # Convert to grayscale for OCR
        gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, thresh_roi = cv2.threshold(gray_roi, 150, 255, cv2.THRESH_BINARY)

        # Run OCR
        results = reader.readtext(thresh_roi, detail=0)
        text = " ".join(results) if results else " "

        extracted_data.append({"id": i, "text": text})
        html_structure += f"<div class='element' style='top: {y}px; left: {x}px; width: {w}px; height: {h}px;' id='element-{i}'>{text}</div>\n"

    html_structure += """
        </div>
    </body>
    </html>
    """

    return {"html": html_structure}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5001)
