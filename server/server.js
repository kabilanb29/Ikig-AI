require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const cleanMarkdown = (text) => text.replace(/\*/g, '');
const summarizeResponse = (text) => {
    const sentences = text.split('. ').slice(0, 3); 
    return sentences.join('. ') + (sentences.length > 1 ? '.' : '');
};
const mysql = require('mysql2');
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '1234',
    database: 'chat_app'
});
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const storage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    dest: 'uploads/', // Temporary directory for uploaded files
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB file size limit
});
//Database connection
db.connect((err) => {
    if (err) throw err;
    console.log('MySQL connected...');

    db.query('UPDATE users SET socket_id = NULL', (err) => {
        if (err) throw err;
    });
});

db.query('TRUNCATE TABLE messages', (err) => {
    if (err) throw err;
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use('/public', express.static(path.join(__dirname, 'public')));


// Stress Detection API Endpoint
app.post('/api/stress-detection', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image data received' });
    }

    const imagePath = req.file.path;

    // Spawn Python process to execute the model
    const pythonProcess = spawn('python', [path.join(__dirname, 'stress_model.py'), imagePath]);

    let output = '';
    let errorOutput = '';

    // Capture stdout data from the Python process
    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
    });

    // Capture stderr data for debugging in case of errors
    pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('Error in Python script:', data.toString());
    });

    // Handle process close event
    pythonProcess.on('close', (code) => {
        // Remove the uploaded image after processing
        fs.unlinkSync(imagePath);

        if (code === 0) {
            try {
                // Parse the output from the Python script
                const result = JSON.parse(output);
                console.log('Model output:', result);

                res.json({
                    stressLabel: result.stress_label,
                    stressValue: result.stress_value,
                    emotion: result.emotion,
                });
            } catch (parseError) {
                console.error('Error parsing Python output:', output);
                res.status(500).json({ error: 'Failed to parse stress detection response' });
            }
        } else {
            console.error('Python process exited with code:', code, 'Error output:', errorOutput);
            res.status(500).json({ error: 'Error in stress detection process' });
        }
    });

    // Handle unexpected errors in the Python process
    pythonProcess.on('error', (err) => {
        console.error('Failed to start Python process:', err);
        fs.unlinkSync(imagePath);
        res.status(500).json({ error: 'Internal server error' });
    });
});

// Chatbot API Endpoint
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                candidateCount: 1,
                stopSequences: ["x"],
                maxOutputTokens: 175,
                temperature: 0.8,     
            },
        });

        const result = await model.generateContent(message);
        const cleanedResponse = cleanMarkdown(result.response.text());
        const shortResponse = summarizeResponse(cleanedResponse);
        res.json({ response: shortResponse });
    } catch (error) {
        console.error('Error communicating with Google Generative AI:', error.message);
        res.status(500).json({ response: "Sorry, something went wrong while communicating with the AI." });
    }
});

// Dashboard API Endpoint
app.get('/api/dashboard', (req, res) => {
    try {
        const userProgress = {
            progress: 80,
            recentActivity: [
                'Joined Workshop: Stress Management',
                'Completed Meditation Session',
                'Added Goal: Practice Mindfulness',
                'Completed 5-Day Workout Challenge'
            ],
            stressData: [
                { month: 'January', level: 3 },
                { month: 'February', level: 2 },
                { month: 'March', level: 4 },
                { month: 'April', level: 5 },
                { month: 'May', level: 3 },
                { month: 'June', level: 4 },
                { month: 'July', level: 3 }
            ],
            workshops: [
                { name: 'Workshop 1', completed: true },
                { name: 'Workshop 2', completed: false },
                { name: 'Workshop 3', completed: true },
                { name: 'Workshop 4', completed: true }
            ],
            username: 'JohnDoe',
            ranking: 1,
        };

        res.json(userProgress);
    } catch (error) {
        console.error('Error fetching dashboard data:', error.message);
        res.status(500).json({ error: 'Failed to load dashboard data' });
    }
});

// Workshops API Endpoint
app.get('/api/workshops', (req, res) => {
    try {
        const workshops = [
            { title: 'Stress Management 101', date: '2024-11-01', time: '5:00 PM' },
            { title: 'Mindfulness and Meditation', date: '2024-11-05', time: '4:00 PM' },
        ];
        res.json(workshops);
    } catch (error) {
        console.error('Error fetching workshops data:', error.message);
        res.status(500).json({ error: 'Failed to load workshops' });
    }
});

// Community API Endpoint
let onlineUsers = {};

io.on('connection', (socket) => {
    let username = '';

    db.query('SELECT * FROM users WHERE socket_id IS NULL LIMIT 1', (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            const user = results[0];
            username = user.username;

            db.query('UPDATE users SET socket_id = ? WHERE id = ?', [socket.id, user.id], (updateErr) => {
                if (updateErr) throw updateErr;

                socket.emit('assignUsername', username);
                console.log(`${username} connected with socket ID: ${socket.id}`);

                onlineUsers[socket.id] = username;
                io.emit('updateOnlineUsers', Object.values(onlineUsers));
            });
        } else {
            console.log('No available users in the database.');
        }
    });

    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`${username} joined room ${room}`);

        const fetchMessagesQuery = 'SELECT sender, text, timestamp FROM messages WHERE room = ? ORDER BY timestamp ASC';
        db.query(fetchMessagesQuery, [room], (err, results) => {
            if (err) throw err;
            socket.emit('loadPreviousMessages', results);
        });
    });

    socket.on('sendMessage', (message, room) => {
        db.query('SELECT username FROM users WHERE socket_id = ?', [socket.id], (err, results) => {
            if (err) throw err;

            if (results.length > 0) {
                username = results[0].username;

                const insertQuery = 'INSERT INTO messages (room, sender, text) VALUES (?, ?, ?)';
                db.query(insertQuery, [room, username, message], (insertErr) => {
                    if (insertErr) throw insertErr;

                    io.to(room).emit('receiveMessage', { text: message, sender: username, timestamp: new Date() });
                    console.log(`Message sent to room ${room}: ${message}`);
                });
            }
        });
    });

    socket.on('disconnect', () => {
        if (username) {
            delete onlineUsers[socket.id];
            io.emit('updateOnlineUsers', Object.values(onlineUsers));

            db.query('UPDATE users SET socket_id = NULL WHERE socket_id = ?', [socket.id], (err) => {
                if (err) throw err;
                console.log(`${username} disconnected`);
            });
        }
    });
});



const PORT = 5000;
// Start Server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
