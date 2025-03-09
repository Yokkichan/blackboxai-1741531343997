// Socket.IO connection
let socket = io();

// Audio recording variables
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// DOM Elements
const micButton = document.getElementById('mic-button');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const voiceSelect = document.getElementById('voice-id');
const languageSelect = document.getElementById('language');

// Initialize WebSocket connection
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Handle voice response from server
socket.on('message_response', (data) => {
    playAudio(data.audio_url);
    // Trigger avatar speaking animation
    triggerSpeakingAnimation();
});

socket.on('error', (data) => {
    console.error('Error:', data.message);
});

// Voice Recording Functions
async function initializeMediaRecorder() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            await sendAudioToServer(audioBlob);
            audioChunks = [];
        };
        
        return true;
    } catch (error) {
        console.error('Error initializing media recorder:', error);
        return false;
    }
}

async function startRecording() {
    if (!mediaRecorder) {
        const initialized = await initializeMediaRecorder();
        if (!initialized) return;
    }
    
    mediaRecorder.start();
    isRecording = true;
    micButton.classList.add('recording');
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        micButton.classList.remove('recording');
    }
}

async function sendAudioToServer(audioBlob) {
    // Convert audio blob to WAV format
    const wavBlob = await convertToWav(audioBlob);
    
    const formData = new FormData();
    formData.append('audio', wavBlob, 'recording.wav');
    formData.append('language', languageSelect.value);
    
    try {
        const response = await fetch('/api/speech-to-text', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Speech-to-text failed');
        
        const data = await response.json();
        socket.emit('send_message', {
            text: data.text,
            language: languageSelect.value
        });
        
    } catch (error) {
        console.error('Error sending audio:', error);
    }
}

// Audio Playback
function playAudio(url) {
    const audio = new Audio(url);
    audio.onplay = () => {
        startSpeakingAnimation();
    };
    audio.onended = () => {
        stopSpeakingAnimation();
    };
    audio.play().catch(console.error);
}

// Avatar Animation Controls
let currentAnimation = null;
let isAnimating = false;

function startSpeakingAnimation() {
    if (!isAnimating) {
        isAnimating = true;
        // Trigger speaking animation in Three.js
        if (window.avatarMixer && window.speakingAnimation) {
            currentAnimation = window.avatarMixer.clipAction(window.speakingAnimation);
            currentAnimation.setLoop(THREE.LoopRepeat);
            currentAnimation.play();
        }
    }
}

function stopSpeakingAnimation() {
    if (isAnimating) {
        isAnimating = false;
        // Stop speaking animation
        if (currentAnimation) {
            currentAnimation.stop();
            // Return to idle animation
            if (window.idleAnimation) {
                const idleAction = window.avatarMixer.clipAction(window.idleAnimation);
                idleAction.play();
            }
        }
    }
}

// File Upload Handling
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            uploadStatus.textContent = 'File uploaded successfully';
            uploadStatus.className = 'mt-2 text-sm text-green-500';
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        uploadStatus.textContent = `Error: ${error.message}`;
        uploadStatus.className = 'mt-2 text-sm text-red-500';
    }
}

// Event Listeners
micButton.addEventListener('mousedown', startRecording);
micButton.addEventListener('mouseup', stopRecording);
micButton.addEventListener('mouseleave', stopRecording);

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        uploadFile(file);
    }
});

voiceSelect.addEventListener('change', () => {
    socket.emit('set_voice', { voice_id: voiceSelect.value });
});

languageSelect.addEventListener('change', () => {
    socket.emit('switch_language', { language: languageSelect.value });
});

// Audio format conversion
async function convertToWav(audioBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Create WAV file
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numberOfChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);
    
    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, length, true);
    
    // Write audio data
    const offset = 44;
    const channels = [];
    for (let i = 0; i < numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }
    
    let index = 0;
    while (index < audioBuffer.length) {
        for (let i = 0; i < numberOfChannels; i++) {
            const sample = Math.max(-1, Math.min(1, channels[i][index]));
            view.setInt16(offset + (index * numberOfChannels + i) * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        index++;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Request microphone permissions early
    initializeMediaRecorder();
});

// Handle visibility change to stop recording if page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording) {
        stopRecording();
    }
});

// Mobile touch events
micButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startRecording();
});

micButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopRecording();
});
