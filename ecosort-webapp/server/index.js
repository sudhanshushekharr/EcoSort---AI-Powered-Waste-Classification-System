// MAIN FILE FOR THE SOCKET CONNECTION PART OF IT

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
require("dotenv").config();

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = 3000;

// Initialize Next.js
const app = next({ dev, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();

// Mock response for testing without Flask server
const mockProcessingResult = {
  status: "success",
  message: "Image processed successfully",
  data: {
    timestamp: new Date().toISOString(),
    detections: [
      { label: "mix", confidence: 0.95 }
    ],
    classification: "mix" // Added classification field for Arduino
  }
};

// Create a global variable to store the Socket.IO instance
let globalSocketIO = null;

// Variable to store the latest classification result
let latestClassification = {
  status: "pending",
  classification: "",
  timestamp: new Date().toISOString()
};

// Variable to store the latest captured image
let latestCapturedImage = null;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

// Function to save base64 image to file
function saveBase64Image(base64Data, filename) {
  // Remove header from base64 string (e.g., "data:image/jpeg;base64,")
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 string');
  }

  const imageBuffer = Buffer.from(matches[2], 'base64');
  const filePath = path.join(uploadsDir, filename);

  fs.writeFileSync(filePath, imageBuffer);
  console.log(`Image saved to ${filePath}`);

  return filePath;
}

// Initialize Google Auth with service account
let googleAuth;
let projectId;

async function initializeGoogleAuth() {
  try {
    // Load the service account JSON file
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (!serviceAccountPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable not set');
    }

    // Check if file exists
    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(`Service account file not found: ${serviceAccountPath}`);
    }

    // Load the JSON file to get project ID
    const serviceAccountData = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    projectId = serviceAccountData.project_id;

    // Initialize Google Auth
    googleAuth = new GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    console.log('Google Auth initialized successfully');
    console.log('Project ID:', projectId);
    
    return true;
  } catch (error) {
    console.error('Error initializing Google Auth:', error);
    return false;
  }
}

// Function to get access token
async function getAccessToken() {
  try {
    const client = await googleAuth.getClient();
    const accessToken = await client.getAccessToken();
    return accessToken.token;
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
}

// Function to classify an image using Vertex AI Gemini API with JSON auth only
async function classifyImageWithGoogleAI(imagePath) {
  try {
    // Get access token
    const accessToken = await getAccessToken();

    // Read the image file as bytes
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');

    // Create a very simple and direct prompt
    const prompt = `You are an image classification system. Analyze the provided image of a single garbage item and classify it into one of the following three categories. Respond with only the category name: "recycle", "waste", or "mix".

    Categories:
    recycle: Items that are clean and recyclable such as paper, cardboard, books, notebooks, cans, glass bottles, or plastic containers for example-bottle caps,pen caps etc.
    
    waste: Items that are non-recyclable, soiled, or disposable, such as used tissues, food-stained wrappers, plastic straws, napkins, or styrofoam, crumbled paper/tissue, sharpner etc.
    
    mix: Items made of two or more different materials that cannot be easily separated, such as juice boxes (plastic + foil + paper), mobile phone, chip packets (plastic + foil), or plastic-lined paper cups. For example-candies,toffee,chocolates,etc.
    
    Do not include any explanation, punctuation, or extra text. Your entire response must be just one word: "recycle", "waste", or "mix".`;

    // Prepare the request payload for Vertex AI
    const requestPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      generation_config: {
        temperature: 0.0,
        max_output_tokens: 2048,
        candidate_count: 1
      },
      safety_settings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH", 
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    // Use Gemini 2.5 Pro as required
    const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent`;
    
    console.log("Making API request to:", apiUrl);
    
    const response = await axios.post(apiUrl, requestPayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Log the full response for debugging
    console.log("Full API Response:", JSON.stringify(response.data, null, 2));

    // Check if response has candidates
    if (!response.data.candidates || response.data.candidates.length === 0) {
      console.error('No candidates found in API response');
      return {
        status: "success",
        data: {
          timestamp: new Date().toISOString(),
          detections: [{ label: "mix", confidence: 0.50 }],
          classification: "mix"
        }
      };
    }

    const candidate = response.data.candidates[0];
    console.log("Candidate finish reason:", candidate.finishReason);
    
    // Handle different finish reasons
    if (candidate.finishReason === 'SAFETY') {
      console.warn('Response blocked due to safety filters, defaulting to mix');
      return {
        status: "success",
        data: {
          timestamp: new Date().toISOString(),
          detections: [{ label: "mix", confidence: 0.50 }],
          classification: "mix"
        }
      };
    }

    if (candidate.finishReason === 'MAX_TOKENS') {
      console.warn('Response truncated due to MAX_TOKENS - this might be normal for Gemini 2.5 Pro');
      // Continue processing as the model might still have generated some content
    }

    // Extract text from response - handle multiple possible structures
    let responseText = '';
    
    // Check for thought process in usage metadata (Gemini 2.5 Pro specific)
    if (response.data.usageMetadata && response.data.usageMetadata.thoughtsTokenCount > 0) {
      console.log('Model used', response.data.usageMetadata.thoughtsTokenCount, 'tokens for thinking');
    }
    
    if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
      responseText = candidate.content.parts[0].text;
    } else if (candidate.content && candidate.content.text) {
      responseText = candidate.content.text;
    } else if (candidate.text) {
      responseText = candidate.text;
    } else {
      // For Gemini 2.5 Pro, sometimes the actual classification might be in metadata or other fields
      console.log('Standard text extraction failed, checking for alternative response formats...');
      
      // Try to extract from the entire candidate object
      const candidateStr = JSON.stringify(candidate);
      console.log('Full candidate object:', candidateStr);
      
      // Look for classification keywords anywhere in the response
      if (candidateStr.toLowerCase().includes('recycle')) {
        responseText = 'recycle';
        console.log('Found "recycle" in response metadata');
      } else if (candidateStr.toLowerCase().includes('waste')) {
        responseText = 'waste';
        console.log('Found "waste" in response metadata');
      } else {
        // Since we can't extract meaningful text, let's try a different approach
        // Make another request with a more direct prompt
        console.log('Retrying with simplified prompt...');
        
        const retryPayload = {
          contents: [
            {
              role: "user",
              parts: [
                { text: "recycle, waste, or mix?" },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generation_config: {
            temperature: 0.0,
            max_output_tokens: 2048,
            candidate_count: 1
          }
        };

        try {
          const retryResponse = await axios.post(apiUrl, retryPayload, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          });

          console.log('Retry response:', JSON.stringify(retryResponse.data, null, 2));
          
          if (retryResponse.data.candidates && retryResponse.data.candidates[0].content && 
              retryResponse.data.candidates[0].content.parts && 
              retryResponse.data.candidates[0].content.parts[0].text) {
            responseText = retryResponse.data.candidates[0].content.parts[0].text;
            console.log('Got text from retry:', responseText);
          }
        } catch (retryError) {
          console.warn('Retry failed:', retryError.message);
        }
        
        if (!responseText) {
          console.warn('No text found in response after retry, defaulting to mix');
          return {
            status: "success",
            data: {
              timestamp: new Date().toISOString(),
              detections: [{ label: "mix", confidence: 0.50 }],
              classification: "mix"
            }
          };
        }
      }
    }

    // Clean and normalize the response
    responseText = responseText.trim().toLowerCase().replace(/[^a-z]/g, '');
    console.log("Cleaned response text:", responseText);

    // Map the response to one of our categories with exact matching
    let classification = "mix"; // Default
    
    if (responseText === "recycle" || responseText.includes("recycle")) {
      classification = "recycle";
    } else if (responseText === "waste" || responseText.includes("waste")) {
      classification = "waste";
    } else if (responseText === "mix" || responseText.includes("mix")) {
      classification = "mix";
    } else {
      // If we get an unexpected response, log it and use mix as default
      console.warn("Unexpected classification response:", responseText, "- defaulting to mix");
      classification = "mix";
    }

    console.log(`Gemini 2.5 Pro classified the image as: ${classification}`);

    return {
      status: "success",
      data: {
        timestamp: new Date().toISOString(),
        detections: [
          { label: classification, confidence: 0.95 }
        ],
        classification: classification
      }
    };

  } catch (error) {
    console.error("Error classifying image with Gemini 2.5 Pro:", error);
    
    // Log more details about the error
    if (error.response) {
      console.error("API Error Response:", JSON.stringify(error.response.data, null, 2));
      console.error("Status:", error.response.status);
      console.error("Status Text:", error.response.statusText);
    } else if (error.request) {
      console.error("No response received:", error.request);
    } else {
      console.error("Error setting up request:", error.message);
    }
    
    // Return a default classification on error
    return {
      status: "success",
      data: {
        timestamp: new Date().toISOString(),
        detections: [{ label: "mix", confidence: 0.50 }],
        classification: "mix"
      }
    };
  }
}

app.prepare().then(async () => {
  // Initialize Google Auth before starting the server
  const authInitialized = await initializeGoogleAuth();
  
  if (!authInitialized) {
    console.error('Failed to initialize Google Auth. Exiting...');
    process.exit(1);
  }

  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);

      // Handle Socket.IO trigger endpoint
      if (parsedUrl.pathname === '/api/trigger-capture' && req.method === 'GET') {
        if (globalSocketIO) {
          // Reset classification status
          latestClassification = {
            status: "pending",
            classification: "",
            timestamp: new Date().toISOString()
          };

          // Reset captured image
          latestCapturedImage = null;

          console.log('Emitting start_capture event to all clients');

          // Create a Promise that will resolve when an image is captured
          const capturePromise = new Promise((resolve, reject) => {
            // Set a timeout to reject the promise after 30 seconds
            const timeoutId = setTimeout(() => {
              reject(new Error('Capture timeout - no image received within 30 seconds'));
            }, 30000);

            // Listen for image_captured event
            const handleImageCaptured = (imageData, socket) => {
              clearTimeout(timeoutId);

              try {
                console.log('Received captured image from client ID:', socket.id);
                console.log('Image data length:', imageData ? imageData.length : 0);

                // Save the image to a file
                const timestamp = new Date().toISOString().replace(/:/g, '-');
                const filename = `capture_${timestamp}.jpg`;
                const filePath = saveBase64Image(imageData, filename);

                // Store the image data
                latestCapturedImage = {
                  timestamp,
                  filename,
                  path: filePath
                };

                // Classify the image using Google's Generative AI
                classifyImageWithGoogleAI(filePath).then(result => {
                  if (result.status === 'success') {
                    // Update the latest classification
                    latestClassification = {
                      status: "success",
                      classification: result.data.classification || "mix",
                      timestamp: new Date().toISOString(),
                      imagePath: filePath
                    };

                    // Send the processing result back to the client
                    socket.emit('processing_result', result);

                    // Resolve the promise with the result
                    resolve(result);
                  } else {
                    console.error('Classification failed:', result.message);
                    reject(new Error('Failed to classify image'));
                  }
                }).catch(error => {
                  console.error('Error classifying image:', error);
                  reject(error);
                });
              } catch (error) {
                console.error('Error processing captured image:', error);
                reject(error);
              }
            };

            // Set up a one-time listener for the image_captured event
            const setupCaptureListener = (socket) => {
              socket.once('image_captured', (imageData) => {
                handleImageCaptured(imageData, socket);
              });
            };

            // Set up listeners for all currently connected clients
            const connectedSockets = Array.from(globalSocketIO.sockets.sockets.values());
            if (connectedSockets.length > 0) {
              console.log(`Setting up capture listeners for ${connectedSockets.length} connected clients:`,
                connectedSockets.map(s => s.id).join(', '));
              connectedSockets.forEach(socket => {
                setupCaptureListener(socket);
                socket.emit('start_capture');
                console.log('Emitted start_capture to client ID:', socket.id);
              });
            } else {
              console.log('No clients connected to capture images');
              // Emit to all future connections within a short time window
              globalSocketIO.emit('start_capture');

              // Set up a listener for new connections
              const connectionHandler = (socket) => {
                console.log('New client connected during capture window');
                setupCaptureListener(socket);
                socket.emit('start_capture');
              };

              globalSocketIO.on('connection', connectionHandler);

              // Remove the connection handler after a short time
              setTimeout(() => {
                globalSocketIO.off('connection', connectionHandler);
              }, 5000);
            }
          });

          try {
            // Wait for the image to be captured
            const result = await capturePromise;

            // Return the result to the client
            const responseJson = JSON.stringify({
              status: "success",
              message: "Image captured and processed successfully",
              classification: result.data.classification, // Add direct classification for Arduino
              data: {
                classification: result.data.classification,
                timestamp: new Date().toISOString(),
                image: latestCapturedImage ? {
                  filename: latestCapturedImage.filename,
                  timestamp: latestCapturedImage.timestamp
                } : null
              }
            });

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(responseJson)
            });

            res.end(responseJson);
          } catch (error) {
            console.error('Error in capture process:', error);

            // Return an error response
            const errorJson = JSON.stringify({
              status: "error",
              message: "Failed to capture image",
              error: error.message
            });

            res.writeHead(500, {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(errorJson)
            });

            res.end(errorJson);
          }
        } else {
          const errorJson = JSON.stringify({ error: 'Socket.IO not initialized', status: 'error' });
          res.writeHead(500, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(errorJson)
          });
          res.end(errorJson);
        }
        return;
      }

      // Simple test endpoint for Arduino
      if (parsedUrl.pathname === '/api/arduino-test' && req.method === 'GET') {
        console.log('Arduino test endpoint accessed');

        // Create response JSON
        const responseJson = JSON.stringify({
          status: "success",
          message: "Arduino connection successful",
          classification: "mix"
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(responseJson)
        });

        res.end(responseJson);
        return;
      }

      // Handle classification result endpoint (for Arduino to poll)
      if (parsedUrl.pathname === '/api/classification-result' && req.method === 'GET') {
        const responseJson = JSON.stringify(latestClassification);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(responseJson)
        });
        res.end(responseJson);
        return;
      }

      // Endpoint to get the latest captured image
      if (parsedUrl.pathname === '/api/latest-image' && req.method === 'GET') {
        if (latestCapturedImage && fs.existsSync(latestCapturedImage.path)) {
          const imageBuffer = fs.readFileSync(latestCapturedImage.path);
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': imageBuffer.length
          });
          res.end(imageBuffer);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('No image available');
        }
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Initialize Socket.IO with the HTTP server
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Store the Socket.IO instance globally
  globalSocketIO = io;

  // Socket.IO event handlers
  io.on('connection', (socket) => {
    console.log('A client connected, ID:', socket.id);

    // Listen for capture image request
    socket.on('capture_image', async (data) => {
      console.log('Received capture image request from client ID:', socket.id);

      // Emit event to client to capture image
      socket.emit('start_capture');

      // Listen for the captured image from client
      socket.on('image_captured', async (imageData) => {
        console.log('Received captured image from client ID:', socket.id);
        console.log('Image data length:', imageData ? imageData.length : 0);

        try {
          // Save the image to a file
          const timestamp = new Date().toISOString().replace(/:/g, '-');
          const filename = `capture_${timestamp}.jpg`;
          const filePath = saveBase64Image(imageData, filename);

          // Store the image data
          latestCapturedImage = {
            timestamp,
            filename,
            path: filePath
          };

          // Classify the image using Google's Generative AI
          const result = await classifyImageWithGoogleAI(filePath);

          if (result.status === 'success') {
            // Update the latest classification
            latestClassification = {
              status: "success",
              classification: result.data.classification || "mix", // Default to "mix" if not present
              timestamp: new Date().toISOString(),
              imagePath: filePath
            };

            // Send the processing result back to the client
            socket.emit('processing_result', result);
          } else {
            console.error('Classification failed:', result.message);
            // Update classification status to error
            latestClassification = {
              status: "error",
              classification: "",
              error: "Failed to process image",
              timestamp: new Date().toISOString()
            };

            socket.emit('error', { message: 'Failed to process image' });
          }
        } catch (error) {
          console.error('Error processing image:', error);
          // Update classification status to error
          latestClassification = {
            status: "error",
            classification: "",
            error: "Failed to process image",
            timestamp: new Date().toISOString()
          };

          socket.emit('error', { message: 'Failed to process image' });
        }
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('A client disconnected, ID:', socket.id);
    });
  });

  // Start server
  server.listen(port, hostname, (err) => {
    if (err) throw err;
    // Get the server's IP address to display to the user
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const results = {};

    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
          if (!results[name]) {
            results[name] = [];
          }
          results[name].push(net.address);
        }
      }
    }

    console.log('> Server is running on the following addresses:');
    for (const [key, value] of Object.entries(results)) {
      console.log(`  ${key}: ${value.join(', ')}`);
    }
    console.log(`> Local: http://localhost:${port}`);
  });
});