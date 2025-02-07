from flask import Flask, request, jsonify
import cv2
import numpy as np
import json
from keras.models import load_model
from tensorflow.keras.utils import img_to_array  # type: ignore
from scipy.spatial import distance as dist
from imutils import face_utils
import dlib
import os

app = Flask(__name__)

# Suppress TensorFlow logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

# Load models
emotion_classifier = load_model(r"K:\Work\Mini _project_S5\server\Stress_Model\_mini_XCEPTION.102-0.66.hdf5", compile=False)
detector = dlib.get_frontal_face_detector()
predictor = dlib.shape_predictor(r"K:\Work\Mini _project_S5\server\Stress_Model\shape_predictor_68_face_landmarks.dat")

# Helper functions
def calculate_eye_distance(eye_points):
    return dist.euclidean(eye_points[0], eye_points[3])

def calculate_lip_distance(lip_points):
    return dist.euclidean(lip_points[3], lip_points[9])

def emotion_finder(faces, frame):
    EMOTIONS = ["angry", "disgust", "scared", "happy", "sad", "surprised", "neutral"]
    x, y, w, h = face_utils.rect_to_bb(faces)
    frame = frame[y:y + h, x:x + w]
    roi = cv2.resize(frame, (64, 64))
    roi = roi.astype("float") / 255.0
    roi = img_to_array(roi)
    roi = np.expand_dims(roi, axis=0)

    try:
        preds = emotion_classifier.predict(roi)[0]
    except Exception as e:
        print("Error in prediction:", e)
        return "Unknown"
    
    label = EMOTIONS[preds.argmax()]
    return "Stressed" if label in ['scared', 'sad', 'angry'] else "Not Stressed"

def detect_stress(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    detections = detector(gray, 1)
    
    if detections:
        for detection in detections:
            emotion = emotion_finder(detection, gray)
            shape = predictor(gray, detection)
            shape = face_utils.shape_to_np(shape)

            left_eye = shape[36:42]
            right_eye = shape[42:48]
            mouth = shape[48:60]

            eye_distance = (calculate_eye_distance(left_eye) + calculate_eye_distance(right_eye)) / 2
            lip_distance = calculate_lip_distance(mouth)

            stress_value = np.exp(-((eye_distance + lip_distance) / 2))
            stress_label = "High Stress" if stress_value >= 0.65 else "Low Stress"

            return {
                "stress_label": stress_label,
                "stress_value": round(stress_value, 2),
                "emotion": emotion
            }
    return {
        "stress_label": "No Face Detected",
        "stress_value": 0,
        "emotion": "Unknown"
    }

@app.route('/detect_stress', methods=['POST'])
def stress_api():
    try:
        # Read the image from the POST request
        file = request.files['image']
        image = np.frombuffer(file.read(), np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({"error": "Invalid image file."}), 400

        # Detect stress
        result = detect_stress(frame)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)
