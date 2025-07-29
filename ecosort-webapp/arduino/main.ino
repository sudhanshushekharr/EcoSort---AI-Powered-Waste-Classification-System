#include <avr/wdt.h> 
#include <SoftwareSerial.h>
#include <Servo.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Function declarations
String sendATCommand(String command, int timeout, bool debug = true);
bool connectToWiFi();
void hardResetESP8266();
bool checkESP8266Health();
bool checkWiFiStatus();
String attemptTCPConnection();
String attemptAlternativeTCP();
String parseHTTPResponse(String httpResponse);
void playTone(int frequency, int duration);
void playSuccessSound();
void playErrorSound();
void playAlertSound();
void playStartupSound();
long measureDistance();
String triggerCaptureEvent();
void operateLid();
void displayThankYou(String classification);
void displayWelcome();
String captureHTTPResponse(int timeout);

// ESP8266 pins for Software Serial
#define ESP8266_RX 2
#define ESP8266_TX 3

// Create Software Serial object for ESP8266
SoftwareSerial esp8266(ESP8266_RX, ESP8266_TX);

// WiFi credentials - moved to PROGMEM to save RAM
const char ssid[] PROGMEM = "";
const char password[] PROGMEM = "";
const char host[] PROGMEM ="10.178.39.243";

// Server configuration
const int httpPort = 3000;

Servo classificationServo;
Servo lidServo;

// Pin definitions
const int CLASSIFICATION_SERVO_PIN = 9;
const int LID_SERVO_PIN = 10;
const int SPEAKER_PIN = 6;
const int TRIGGER_PIN = 7;
const int ECHO_PIN = 8;

// Sound frequencies
const int NOTE_C5 = 523;
const int NOTE_E5 = 659;
const int NOTE_G5 = 784;
const int NOTE_C6 = 1047;

// Servo positions
const int POSITION_MIX = 0;
const int POSITION_WASTE = 90;
const int POSITION_RECYCLE = 180;
const int LID_CLOSED = 100;
const int LID_OPEN = 0;
const int LID_OPEN_TIME = 2000;

// LCD settings  
const int LCD_I2C_ADDR = 0x27;
const int LCD_COLS = 16;
const int LCD_ROWS = 2;

// Initialize LCD
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);

// Custom character for smiley face - moved to PROGMEM
const byte smileyChar[8] PROGMEM = {
  B00000,
  B10001,
  B00000,
  B00000,
  B10001,
  B01110,
  B00000,
  B00000
};

// Ultrasonic sensor threshold
const long THRESHOLD_DISTANCE = 4;

void setup() {
  Serial.begin(9600);
  while (!Serial) {
    ; // Wait for serial port to connect
  }
  delay(1000);
  
  Serial.println(F("Starting setup..."));
  
  // Initialize LCD
  lcd.init();
  lcd.backlight();
  
  // Load custom character from PROGMEM
  byte tempChar[8];
  memcpy_P(tempChar, smileyChar, 8);
  lcd.createChar(0, tempChar);
  displayWelcome();
  
  // Initialize servos - attach, move to position, then detach
  classificationServo.attach(CLASSIFICATION_SERVO_PIN);
  classificationServo.write(POSITION_WASTE);
  delay(500);
  classificationServo.detach();
  
  lidServo.attach(LID_SERVO_PIN);
  lidServo.write(LID_CLOSED);
  delay(500);
  lidServo.detach();
  
  // Initialize ultrasonic sensor
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  
  // Test ultrasonic sensor
  Serial.println(F("Testing ultrasonic sensor..."));
  for(int i = 0; i < 3; i++) {
    long distance = measureDistance();
    Serial.print(F("Distance: "));
    Serial.print(distance);
    Serial.println(F(" cm"));
    delay(500);
  }
  
  // Initialize speaker
  pinMode(SPEAKER_PIN, OUTPUT);
  playStartupSound();
  
  // Initialize ESP8266
  Serial.println(F("Initializing ESP8266..."));
  esp8266.begin(9600);
  delay(2000);
  
  // Test AT command
  bool espReady = false;
  for(int i = 0; i < 5; i++) {
    Serial.print(F("AT Test "));
    Serial.println(i+1);
    
    String response = sendATCommand(F("AT"), 2000);
    
    if(response.indexOf(F("OK")) != -1) {
        espReady = true;
        Serial.println(F("ESP8266 OK!"));
        break;
    } else {
        Serial.println(F("Retry..."));
        delay(2000);
    }
  }
  
  if(!espReady) {
    Serial.println(F("ESP8266 Error"));
    lcd.clear();
    lcd.print(F("ESP8266 Error"));
    playErrorSound();
    while(1);
  }
  
  // Connect to WiFi
  if(!connectToWiFi()) {
    Serial.println(F("WiFi Error"));
    lcd.clear();
    lcd.print(F("WiFi Error"));
    playErrorSound();
    while(1);
  }
  
  // Test server connection with multiple attempts
  Serial.println(F("=== Testing Server Connection ==="));
  bool serverOK = false;
  for(int i = 0; i < 3; i++) {
    Serial.print(F("Server test "));
    Serial.println(i+1);
    String testResult = triggerCaptureEvent();
    if(testResult != "") {
      Serial.print(F("Server test successful: "));
      Serial.println(testResult);
      serverOK = true;
      break;
    }
    delay(5000);
  }
  
  if(serverOK) {
    Serial.println(F("Server OK!"));
    playSuccessSound();
    displayWelcome();
  } else {
    Serial.println(F("Server Error"));
    lcd.clear();
    lcd.print(F("Server Error"));
    playErrorSound();
    // Don't halt - continue running for debugging
    delay(3000);
    displayWelcome();
  }
  
  Serial.println(F("Setup complete!"));
}

void loop() {
  long distance = measureDistance();
  
  if(distance > 0 && distance < THRESHOLD_DISTANCE) {
    Serial.print(F("Object detected at "));
    Serial.print(distance);
    Serial.println(F(" cm"));
    
    playTone(NOTE_C5, 200);
    
    // Step 1: Get classification result from server
    String classification = triggerCaptureEvent();
    
    if(classification != "") {
      Serial.print(F("Classification: "));
      Serial.println(classification);
      
      // Step 2: Move classification servo to correct position FIRST
      classificationServo.attach(CLASSIFICATION_SERVO_PIN);
      if(classification.equals(F("recycle"))) {
        classificationServo.write(POSITION_RECYCLE);
        Serial.println(F("Classification servo moved to RECYCLE position"));
      } else if(classification.equals(F("waste"))) {
        classificationServo.write(POSITION_WASTE);
        Serial.println(F("Classification servo moved to WASTE position"));
      } else {
        classificationServo.write(POSITION_MIX);
        Serial.println(F("Classification servo moved to MIX position"));
      }
      delay(1000); // Wait for servo to reach position
      classificationServo.detach();
      
      // Step 3: Now operate the lid (open -> wait -> close)
      Serial.println(F("Now operating lid to drop object in correct compartment"));
      operateLid();
      
      // Step 4: Display thank you message
      displayThankYou(classification);
      playSuccessSound();
      
      delay(1000);
      
      // Step 5: Return classification servo to default position
      Serial.println(F("Returning classification servo to default WASTE position"));
      classificationServo.attach(CLASSIFICATION_SERVO_PIN);
      classificationServo.write(POSITION_WASTE);
      delay(1000);
      classificationServo.detach();
      displayWelcome();
      
    } else {
      playErrorSound();
      lcd.clear();
      lcd.print(F("Classification"));
      lcd.setCursor(0, 1);
      lcd.print(F("Failed"));
      delay(2000);
      displayWelcome();
    }
  }
  
  delay(500);
}

void testBasicConnectivity() {
    Serial.println(F("\n=== Basic Connectivity Test ==="));
    
    // Test 1: Can we connect?
    sendATCommand(F("AT+CIPSTART=\"TCP\",\"192.168.129.7\",3000"), 10000);
    delay(2000);
    
    // Test 2: Can we send data?
    sendATCommand(F("AT+CIPSEND=20"), 5000);
    delay(500);
    esp8266.print(F("GET / HTTP/1.1\r\n\r\n"));
    
    // Test 3: What do we get back?
    delay(5000);
    String response = "";
    while (esp8266.available()) {
        char c = esp8266.read();
        response += c;
        if (c >= 32 && c <= 126) Serial.print(c);
        delay(2);
    }
    
    Serial.println(F("\n=== End Basic Test ==="));
    sendATCommand(F("AT+CIPCLOSE"), 1000);
}

String extractClassificationFromGarbledData(String data) {
    Serial.println(F("Analyzing data for classification patterns..."));
    
    Serial.print(F("Data to analyze: "));
    Serial.println(data);
    
    String lowerData = data;
    lowerData.toLowerCase();
    
    if (lowerData.indexOf(F("recycle")) != -1 || 
        lowerData.indexOf(F("rcycl")) != -1 || 
        lowerData.indexOf(F("ecycl")) != -1 ||
        lowerData.indexOf(F("recyc")) != -1 ||
        lowerData.indexOf(F("rcl")) != -1) {
        Serial.println(F("Pattern match: RECYCLE"));
        return "recycle";
    }
    
    if (lowerData.indexOf(F("waste")) != -1 || 
        lowerData.indexOf(F("wast")) != -1 || 
        lowerData.indexOf(F("wste")) != -1 ||
        lowerData.indexOf(F("aste")) != -1) {
        Serial.println(F("Pattern match: WASTE"));
        return "waste";
    }
    
    if (lowerData.indexOf(F("\"mix\"")) != -1 || 
        lowerData.indexOf(F("classification\":\"mix")) != -1 ||
        lowerData.indexOf(F("label\":\"mix")) != -1 || 
        lowerData.indexOf(F(" mix")) != -1 || 
        lowerData.indexOf(F("mix ")) != -1 || 
        lowerData.indexOf(F(" mix ")) != -1) {
        Serial.println(F("Pattern match: MIX"));
        return "mix";
    }
    
    Serial.println(F("No clear pattern found"));
    return "";
}

// Helper function to play tones
void playTone(int frequency, int duration) {
  tone(SPEAKER_PIN, frequency, duration);
  delay(duration);
  noTone(SPEAKER_PIN);
}

// Enhanced sendATCommand with better buffer handling
String sendATCommand(String command, int timeout, bool debug) {
    String response = "";
    response.reserve(2048); // Increased buffer size for HTTP responses
    
    if(debug) {
        Serial.print(F("Sending: "));
        Serial.println(command);
    }
    
    // Clear any existing data
    esp8266.flush();
    while(esp8266.available()) {
        esp8266.read();
    }
    
    esp8266.println(command);
    
    long startTime = millis();
    bool foundPrompt = false;
    
    while((millis() - startTime) < timeout) {
        while(esp8266.available()) {
            char c = esp8266.read();
            response += c;
            
            // Check for the '>' prompt which indicates ready to send data
            if(c == '>' && command.startsWith("AT+CIPSEND")) {
                foundPrompt = true;
                if(debug) {
                    Serial.println(F("Found > prompt"));
                }
                break;
            }
            
            // Prevent memory overflow
            if(response.length() > 1800) {
                if(debug) {
                    Serial.println(F("Response buffer limit reached"));
                }
                break;
            }
        }
        
        if(foundPrompt) break;
        
        // Small delay to prevent overwhelming the serial buffer
        delay(10);
    }
    
    if(debug && response.length() > 0) {
        Serial.print(F("Received: "));
        Serial.println(response);
    }
    
    return response;
}

// Improved HTTP response capture function
String captureHTTPResponse(int timeout) {
    String response = "";
    response.reserve(2048);
    
    Serial.println(F("Capturing HTTP response..."));
    
    long startTime = millis();
    bool httpStarted = false;
    bool jsonStarted = false;
    int bracketCount = 0;
    
    while((millis() - startTime) < timeout) {
        while(esp8266.available()) {
            char c = esp8266.read();
            response += c;
            
            // Look for HTTP response start
            if(!httpStarted && response.indexOf("HTTP/1.1") != -1) {
                httpStarted = true;
                Serial.println(F("HTTP response detected"));
            }
            
            // Look for JSON start
            if(httpStarted && !jsonStarted && c == '{') {
                jsonStarted = true;
                bracketCount = 1;
                Serial.println(F("JSON start detected"));
            }
            
            // Count brackets to find JSON end
            if(jsonStarted) {
                if(c == '{') bracketCount++;
                else if(c == '}') bracketCount--;
                
                // Complete JSON found
                if(bracketCount == 0) {
                    Serial.println(F("Complete JSON received"));
                    return response;
                }
            }
            
            // Prevent memory overflow
            if(response.length() > 1800) {
                Serial.println(F("Response buffer limit reached"));
                break;
            }
        }
        
        // Check if connection closed
        if(response.indexOf("CLOSED") != -1) {
            Serial.println(F("Connection closed"));
            break;
        }
        
        delay(10);
    }
    
    Serial.print(F("Final response length: "));
    Serial.println(response.length());
    
    return response;
}

// Fixed attemptTCPConnection function
String attemptTCPConnection() {
    Serial.println(F("\n=== Simplified TCP Connection ==="));

    // Close any existing connection
    sendATCommand(F("AT+CIPCLOSE"), 1000, false);
    delay(1000);

    // Set single connection mode
    sendATCommand(F("AT+CIPMUX=0"), 2000, false);
    delay(500);

    // Build connection command
    char hostBuf[20];
    strcpy_P(hostBuf, host);
    String connectCmd = F("AT+CIPSTART=\"TCP\",\"");
    connectCmd += hostBuf;
    connectCmd += F("\",");
    connectCmd += String(httpPort);

    // Attempt connection
    String connectResponse = sendATCommand(connectCmd, 15000, true);
    if (connectResponse.indexOf(F("CONNECT")) == -1 && 
        connectResponse.indexOf(F("OK")) == -1) {
        Serial.println(F("Connection failed"));
        return "";
    }

    Serial.println(F("Connection established"));
    delay(2000); // Let connection stabilize

    // Prepare simple HTTP request
    String httpRequest = F("GET /api/trigger-capture HTTP/1.1\r\n");
    httpRequest += F("Host: ");
    httpRequest += hostBuf;
    httpRequest += F("\r\nConnection: close\r\n\r\n");

    // Send request
    String sendCmd = F("AT+CIPSEND=");
    sendCmd += String(httpRequest.length());

    String sendResponse = sendATCommand(sendCmd, 5000, true);
    
    if (sendResponse.indexOf(F(">")) == -1) {
        Serial.println(F("Failed to get send prompt"));
        sendATCommand(F("AT+CIPCLOSE"), 1000, false);
        return "";
    }

    // Send HTTP request
    Serial.println(F("Sending HTTP request..."));
    esp8266.print(httpRequest);
    esp8266.flush();
    
    delay(1000); // Give server time to process

    // Collect ALL response data with generous timeout
    String fullResponse = "";
    fullResponse.reserve(2048);
    
    unsigned long startTime = millis();
    unsigned long lastDataTime = millis();
    
    Serial.println(F("Collecting response data..."));
    
    while (millis() - startTime < 30000) { // 30 second total timeout
        if (esp8266.available()) {
            char c = esp8266.read();
            fullResponse += c;
            lastDataTime = millis();
            
            // Print character for debugging
            if (c >= 32 && c <= 126) {
                Serial.print(c);
            }
            
            // Prevent buffer overflow
            if (fullResponse.length() > 1800) {
                Serial.println(F("\nBuffer full, processing..."));
                break;
            }
        } else {
            // If no data for 3 seconds and we have some data, consider it complete
            if (fullResponse.length() > 100 && (millis() - lastDataTime) > 3000) {
                Serial.println(F("\nNo more data, processing..."));
                break;
            }
            delay(10);
        }
    }
    
    Serial.println(F("\n=== Response Analysis ==="));
    Serial.print(F("Total response length: "));
    Serial.println(fullResponse.length());
    
    // Close connection
    sendATCommand(F("AT+CIPCLOSE"), 1000, false);
    
    // FIXED: Call parseHTTPResponse instead of manual parsing
    Serial.println(F("Calling parseHTTPResponse..."));
    String classification = parseHTTPResponse(fullResponse);
    
    if (classification != "") {
        Serial.print(F("Successfully parsed classification: "));
        Serial.println(classification);
        return classification;
    }
    
    // Fallback: Try pattern matching on the raw response
    Serial.println(F("Trying pattern matching fallback..."));
    classification = extractClassificationFromGarbledData(fullResponse);
    if (classification != "") {
        Serial.print(F("Pattern matching found: "));
        Serial.println(classification);
        return classification;
    }
    
    // Final fallback: Look for HTTP 200 response
    if (fullResponse.indexOf(F("200 OK")) != -1) {
        Serial.println(F("Server responded with 200 OK but classification unclear"));
        // Try to extract from the visible response in serial output
        if (fullResponse.indexOf(F("recycle")) != -1) {
            Serial.println(F("Found 'recycle' in response"));
            return "recycle";
        }
        if (fullResponse.indexOf(F("waste")) != -1) {
            Serial.println(F("Found 'waste' in response"));
            return "waste";
        }
        if (fullResponse.indexOf(F("mix")) != -1) {
            Serial.println(F("Found 'mix' in response"));
            return "mix";
        }
        // Default to waste if we can't determine
        return "waste";
    }
    
    Serial.println(F("Could not extract classification"));
    return "";
}

// Enhanced parseHTTPResponse function
String parseHTTPResponse(String httpResponse) {
    Serial.println(F("\n=== Parsing Response ==="));
    Serial.print(F("Raw response length: "));
    Serial.println(httpResponse.length());

    if (httpResponse.length() == 0) {
        Serial.println(F("Error: Empty response"));
        return "";
    }

    int ipdIndex = httpResponse.indexOf(F("+IPD,"));
    if (ipdIndex != -1) {
        int colonIndex = httpResponse.indexOf(':', ipdIndex);
        if (colonIndex != -1) {
            httpResponse = httpResponse.substring(colonIndex + 1);
            Serial.println(F("Extracted data from +IPD wrapper"));
        }
    }

    Serial.println(F("Cleaned response:"));
    Serial.println(httpResponse);

    int jsonStart = httpResponse.indexOf('{');
    int jsonEnd = httpResponse.lastIndexOf('}');

    if (jsonStart == -1 || jsonEnd == -1) {
        Serial.println(F("Error: No JSON found in response"));
        
        int classIndex = httpResponse.indexOf(F("\"classification\":\""));
        if (classIndex != -1) {
            int startQuote = classIndex + 17;
            int endQuote = httpResponse.indexOf('"', startQuote);
            if (endQuote != -1) {
                String classification = httpResponse.substring(startQuote, endQuote);
                Serial.print(F("Found classification via fallback: "));
                Serial.println(classification);
                return classification;
            }
        }
        
        if (httpResponse.indexOf(F("recycle")) != -1) {
            Serial.println(F("Found 'recycle' in response"));
            return "recycle";
        }
        if (httpResponse.indexOf(F("waste")) != -1) {
            Serial.println(F("Found 'waste' in response"));
            return "waste";
        }
        if (httpResponse.indexOf(F("mix")) != -1) {
            Serial.println(F("Found 'mix' in response"));
            return "mix";
        }
        
        return "";
    }

    String jsonStr = httpResponse.substring(jsonStart, jsonEnd + 1);
    Serial.println(F("Extracted JSON:"));
    Serial.println(jsonStr);

    StaticJsonDocument<1024> doc; // Increased from 512
    DeserializationError error = deserializeJson(doc, jsonStr);

    if (error) {
        Serial.print(F("JSON parse error: "));
        Serial.println(error.c_str());
        
        int classIndex = jsonStr.indexOf(F("\"classification\":\""));
        if (classIndex != -1) {
            int startQuote = classIndex + 17;
            int endQuote = jsonStr.indexOf('"', startQuote);
            if (endQuote != -1) {
                String classification = jsonStr.substring(startQuote, endQuote);
                Serial.print(F("Manual parsing found: "));
                Serial.println(classification);
                return classification;
            }
        }
        
        if (jsonStr.indexOf(F("recycle")) != -1) return "recycle";
        if (jsonStr.indexOf(F("waste")) != -1) return "waste";
        if (jsonStr.indexOf(F("mix")) != -1) return "mix";
        
        return "";
    }

    String classification = "";
    
    if (doc.containsKey("classification")) {
        classification = doc["classification"].as<String>();
    }
    else if (doc.containsKey("data") && doc["data"].containsKey("classification")) {
        classification = doc["data"]["classification"].as<String>();
    }

    if (classification == "") {
        Serial.println(F("No classification found in JSON"));
        return "";
    }

    Serial.print(F("Successfully parsed classification: "));
    Serial.println(classification);
    return classification;
}

// Check ESP8266 health and status
bool checkESP8266Health() {
  Serial.println(F("Checking ESP8266 health..."));
  
  // Basic AT test
  String response = sendATCommand(F("AT"), 2000);
  if(response.indexOf(F("OK")) == -1) {
    Serial.println(F("ESP8266 not responding to AT"));
    return false;
  }
  
  // Check WiFi status
  response = sendATCommand(F("AT+CWJAP?"), 3000);
  if(response.indexOf(F("No AP")) != -1) {
    Serial.println(F("Not connected to WiFi"));
    return false;
  }
  
  // Get IP and check if valid
  response = sendATCommand(F("AT+CIFSR"), 2000);
  Serial.print(F("IP Info: "));
  Serial.println(response);
  
  return true;
}

bool checkWiFiStatus() {
  Serial.println(F("Checking WiFi status..."));
  
  // Check connection status
  String response = sendATCommand(F("AT+CWJAP?"), 3000);
  if(response.indexOf(F("No AP")) != -1) {
    Serial.println(F("Not connected to WiFi"));
    return false;
  }
  
  // Get IP address
  response = sendATCommand(F("AT+CIFSR"), 2000);
  if(response.indexOf(F("192.168")) == -1) {
    Serial.println(F("No valid IP address"));
    return false;
  }
  
  Serial.println(F("WiFi status OK"));
  return true;
}

// Enhanced WiFi connection with better error handling
bool connectToWiFi() {
  Serial.println(F("Connecting WiFi..."));
  lcd.clear();
  lcd.print(F("Connecting WiFi"));
  
  // Reset ESP8266 first for clean state
  Serial.println(F("Resetting ESP8266..."));
  sendATCommand(F("AT+RST"), 5000);
  delay(3000);
  
  // Set station mode
  sendATCommand(F("AT+CWMODE=1"), 2000);
  delay(1000);
  
  // Disconnect from any existing connection
  sendATCommand(F("AT+CWQAP"), 2000);
  delay(2000);
  
  // Check if already connected
  String checkResponse = sendATCommand(F("AT+CWJAP?"), 2000);
  if(checkResponse.indexOf(F("Wifi")) != -1) { // Your SSID
    Serial.println(F("Already connected"));
    return true;
  }

  // Read credentials from PROGMEM
  char ssidBuf[20];
  char passBuf[20];
  strcpy_P(ssidBuf, ssid);
  strcpy_P(passBuf, password);
  
  // Build connection command
  String cmd = F("AT+CWJAP=\"");
  cmd += ssidBuf;
  cmd += F("\",\"");
  cmd += passBuf;
  cmd += F("\"");
  
  Serial.println(F("Connecting to WiFi..."));
  String response = sendATCommand(cmd, 20000); // Increased timeout
  
  if(response.indexOf(F("OK")) != -1 || response.indexOf(F("CONNECTED")) != -1) {
    Serial.println(F("WiFi connected!"));
    delay(3000); // Wait for IP assignment
    return true;
  } else {
    Serial.println(F("WiFi failed. Response:"));
    Serial.println(response);
    return false;
  }
}

// Main function to trigger capture event with multiple methods
String triggerCaptureEvent() {
  playAlertSound();
  lcd.clear();
  lcd.print(F("Processing..."));
  
  // Health check first
  if(!checkESP8266Health()) {
    Serial.println(F("ESP8266 health check failed"));
    // Try to recover
    if(!connectToWiFi()) {
      return "";
    }
  }
  
  // Method 1: Try standard TCP connection
  String result = attemptTCPConnection();
  if(result != "") {
    return result;
  }
  
  // Method 2: Try with different approach
  Serial.println(F("Trying alternative method..."));
  delay(2000);
  result = attemptAlternativeTCP();
  
  return result;
}

// Alternative TCP method with different timing
String attemptAlternativeTCP() {
    Serial.println(F("=== Ultra-Simple Alternative ==="));
    
    // Just try to get ANY response and look for keywords
    sendATCommand(F("AT+CIPCLOSE"), 1000, false);
    delay(500);
    
    sendATCommand(F("AT+CIPMUX=0"), 2000, false);
    delay(500);
    
    char hostBuf[20];
    strcpy_P(hostBuf, host);
    
    String connectCmd = F("AT+CIPSTART=\"TCP\",\"");
    connectCmd += hostBuf;
    connectCmd += F("\",3000");
    
    String connectResponse = sendATCommand(connectCmd, 15000);
    
    if (connectResponse.indexOf(F("OK")) == -1 && connectResponse.indexOf(F("CONNECT")) == -1) {
        Serial.println(F("Alternative connection failed"));
        return "";
    }
    
    Serial.println(F("Alternative connected"));
    delay(3000);
    
    // Send minimal request
    String httpRequest = F("GET /api/trigger-capture HTTP/1.1\r\nHost: ");
    httpRequest += hostBuf;
    httpRequest += F("\r\n\r\n");
    
    String sendCmd = F("AT+CIPSEND=");
    sendCmd += String(httpRequest.length());
    
    String sendResponse = sendATCommand(sendCmd, 5000);
    if (sendResponse.indexOf(F(">")) != -1) {
        esp8266.print(httpRequest);
        esp8266.flush();
        
        // Wait and collect everything
        delay(5000);
        
        String response = "";
        while (esp8266.available()) {
            response += (char)esp8266.read();
            delay(1); // Very slow read
        }
        
        Serial.println(F("Alternative response:"));
        Serial.println(response);
        
        // Use pattern matching
        String result = extractClassificationFromGarbledData(response);
        
        sendATCommand(F("AT+CIPCLOSE"), 1000, false);
        
        // If pattern matching fails, look for any success indication
        if (result == "" && response.indexOf(F("200")) != -1) {
            Serial.println(F("Got 200 response, defaulting to recycle"));
            return "recycle"; // Default assumption
        }
        
        return result;
    }
    
    return "";
}

void playSuccessSound() {
  playTone(NOTE_C5, 150);
  playTone(NOTE_E5, 150);
  playTone(NOTE_G5, 150);
  playTone(NOTE_C6, 300);
}

void playErrorSound() {
  playTone(NOTE_C6, 200);
  playTone(NOTE_E5, 200);
  playTone(NOTE_C5, 400);
}

void playAlertSound() {
  playTone(NOTE_G5, 100);
  delay(50);
  playTone(NOTE_G5, 100);
}

void playStartupSound() {
  playTone(NOTE_C5, 100);
  delay(20);
  playTone(NOTE_E5, 100);
  delay(20);
  playTone(NOTE_G5, 100);
  delay(20);
  playTone(NOTE_C6, 300);
}

long measureDistance() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);
  
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  long distance = duration * 0.034 / 2;
  
  return distance;
}

void operateLid() {
  Serial.println(F("Opening lid..."));
  lidServo.attach(LID_SERVO_PIN);
  lidServo.write(LID_OPEN);
  playTone(NOTE_E5, 200);
  delay(LID_OPEN_TIME - 200);
  
  Serial.println(F("Closing lid..."));
  lidServo.write(LID_CLOSED);
  playTone(NOTE_C5, 200);
  delay(500); // Give time to close before detaching
  lidServo.detach();
}

void displayThankYou(String classification) {
  lcd.clear();
  lcd.print(F("Thank You! "));
  lcd.write(byte(0));
  lcd.setCursor(0, 1);
  lcd.print(F("Type: "));
  lcd.print(classification);
}

void displayWelcome() {
  lcd.clear();
  lcd.print(F("Garbage Sorter"));
  lcd.setCursor(0, 1);
  lcd.print(F("Ready for items"));
}