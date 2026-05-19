// CSE 493 F A3

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_ADXL343.h>
#include <Adafruit_Sensor.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR 0x3D //I2C Address

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_ADXL343 accel = Adafruit_ADXL343(1);

const int JOY_X_PIN  = A0;
const int JOY_Y_PIN  = A1;
const int JOY_SW_PIN = 2;

unsigned long lastSend = 0;
const unsigned long SEND_MS = 30; 

int currentScore = 0;
int currentLevel = 1;
String hitFlashText = "";
int animationOverlayTimer = 0;
String incomingCmd = "";

void setup() {
  Serial.begin(115200);
  pinMode(JOY_SW_PIN, INPUT_PULLUP);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    while (true) delay(100);
  }

  if (!accel.begin()) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("ADXL343 Missing!");
    display.display();
    while (true) delay(100);
  }
  // ±4 g range gives enough headroom to detect a firm whack
  accel.setRange(ADXL343_RANGE_4_G);

  renderOLEDHUD();
}

void loop() {
  unsigned long now = millis();

  if (now - lastSend >= SEND_MS) {
    lastSend = now;
    streamTelemetry();
  }

  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      executeIncomingCommand(incomingCmd);
      incomingCmd = ""; 
    } else if (c != '\r') {
      incomingCmd += c;
    }
  }

  //refresh and keep separate from other telemetry loop without blocking
  static unsigned long lastOLEDUpdate = 0;
  if (now - lastOLEDUpdate >= 40) { 
    lastOLEDUpdate = now;
    
    if (animationOverlayTimer > 0) {
      // temporary hit overlay
      drawHitFlash();
      animationOverlayTimer--;
    } else {
      renderOLEDHUD();
    }
  }
}

void streamTelemetry() {
  int jX = analogRead(JOY_X_PIN);
  int jY = analogRead(JOY_Y_PIN);
  int jSW = digitalRead(JOY_SW_PIN) == LOW ? 1 : 0;

  sensors_event_t event;
  accel.getEvent(&event);
  
  // AI use: convert to SI units to g-force
  float ax = event.acceleration.x / 9.80665;
  float ay = event.acceleration.y / 9.80665;
  float az = event.acceleration.z / 9.80665;

  // Send data in one line so easy for p5.js to split
  Serial.print(jX);     Serial.print(",");
  Serial.print(jY);     Serial.print(",");
  Serial.print(jSW);    Serial.print(",");
  Serial.print(ax, 3);  Serial.print(",");
  Serial.print(ay, 3);  Serial.print(",");
  Serial.println(az, 3);
}

void executeIncomingCommand(String cmd) {
  cmd.trim();
  
  if (cmd.startsWith("HIT:")) {
    hitFlashText = cmd.substring(4); 
    animationOverlayTimer = 15; 
  }
  else if (cmd.startsWith("UPDATE:")) {
    // AI use: Slice string to parse CSV without full JSON lib
    int commaIdx = cmd.indexOf(',');
    if (commaIdx > 0) {
      currentScore = cmd.substring(7, commaIdx).toInt();
      currentLevel = cmd.substring(commaIdx + 1).toInt();
    }
  }
}

void renderOLEDHUD() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("GAME HUD [LVL ");
  display.print(currentLevel);
  display.print("]");
  display.drawLine(0, 12, 128, 12, SSD1306_WHITE);

  display.setCursor(0, 22);
  display.print("SCORE");
  display.setTextSize(3);
  display.setCursor(0, 36);
  display.print(currentScore);
  
  display.display();
}

void drawHitFlash() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(40, 6);
  display.print("HIT!");

  display.setTextSize(3);
  display.setCursor(45, 32);
  display.print(hitFlashText);

  if (animationOverlayTimer % 2 == 0) {
    display.drawRect(0, 0, 128, 64, SSD1306_WHITE);
  }

  display.display();
}
