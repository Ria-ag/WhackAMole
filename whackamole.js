// Whack-a-Mole

let serial, pHtmlMsg;
let serialOptions = { baudRate: 115200 };

// Raw buffers
let joyX = 512, joyY = 512;
let accelX = 0, accelY = 0, accelZ = 1; //g-force units
let prevAccelMag = 1;
let shakeDeltas = []; // circluar buffer of last 12 magnitude changes
let shakeAvg = 0;
let shakePulse = 0; // smoothed 0-1 value that triggers a whack

// Game Systems Tracking
let gameScore = 0;
let gameLevel = 1;
let selectedHole = 0;
let fakeHitCount = 0; // 3 = game over
let isGameOver = false;

let moleHoleIndex = -1; 
let moleState = "hiding"; // "hiding", "up", "whacked"
let moleType = "real";    // "real" or "fake"
let stateTimer = 0;
let moleTimer = 0;
let screenFlashTimer = 0;
let backgroundFlashColor = [0, 0, 0];

let holes = [];
let t = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  rectMode(CENTER);
  textAlign(CENTER, CENTER);
  initGridGeometry();

  serial = new Serial();
  serial.on(SerialEvents.CONNECTION_OPENED, onSerialConnectionOpened);
  serial.on(SerialEvents.CONNECTION_CLOSED, onSerialConnectionClosed);
  serial.on(SerialEvents.DATA_RECEIVED, onSerialDataReceived);
  serial.on(SerialEvents.ERROR_OCCURRED, onSerialErrorOccurred);
  serial.autoConnectAndOpenPreviouslyApprovedPort(serialOptions);

  pHtmlMsg = createP("click anywhere to connect serial");
  pHtmlMsg.style("color","rgba(240,240,255,0.45)");
  pHtmlMsg.style("font-family","sans-serif");
  pHtmlMsg.style("font-size","12px");
  pHtmlMsg.style("position","fixed");
  pHtmlMsg.style("bottom","16px");
  pHtmlMsg.style("left","22px");
}

function initGridGeometry() {
  holes = [
    { x: width * 0.30, y: height * 0.35 }, // Hole 0: Top-Left
    { x: width * 0.70, y: height * 0.35 }, // Hole 1: Top-Right
    { x: width * 0.30, y: height * 0.70 }, // Hole 2: Bottom-Left
    { x: width * 0.70, y: height * 0.70 }  // Hole 3: Bottom-Right
  ];
}

function draw() {
  if (isGameOver) {
    drawGameOverScreen();
    checkGameOverReset();
    return;
  }

  updateGameLoop();

  if (screenFlashTimer > 0) {
    // on a hit
    background(backgroundFlashColor[0], backgroundFlashColor[1],                            backgroundFlashColor[2]);
    screenFlashTimer--;
  } else {
    background(210, 50, 25); 
  }

  // AI use: screen offsets a little each frame giving it a camera-shake feel when controller is physically moved
  let shakeX = random(-shakeAvg, shakeAvg) * 35;
  let shakeY = random(-shakeAvg, shakeAvg) * 35;
  push();
  translate(shakeX, shakeY);

  drawHolesAndMoles();
  drawCrosshairAndHammer();
  
  pop(); // undo shake before score and level panel

  drawHUDOverlay();
  t += 0.05;
}

function updateGameLoop() {
  stateTimer++;
  selectedHole = getJoystickQuadrant();

  // AI use: speed scaling: hiding delay shrinks as level rises
  // max prevents from reaching 0 (moles would never pause)
  let currentHidingDelay = max(12, 40 - (gameLevel * 4));

  if (moleState === "hiding") {
    if (stateTimer > currentHidingDelay) {
      moleHoleIndex = floor(random(4));
      moleState = "up";
      stateTimer = 0;
      
      // AI use: popup time drops significantly per level
      moleTimer = max(15, 90 - (gameLevel * 14));
      moleType = (random(1.0) < 0.25) ? "fake" : "real";
    }
  } 
  else if (moleState === "up") {
    moleTimer--;
    let activeSelection = selectedHole;
    let physicalWhackAction = (joyY < 250) || (shakePulse > 0.45);

    if (physicalWhackAction && activeSelection === moleHoleIndex) {
      moleState = "whacked";
      stateTimer = 0;
      screenFlashTimer = 6;
      shakePulse = 0;  // clear shake so one big movement only whacks once
      
      if (moleType === "real") {
        gameScore += 1; 
        backgroundFlashColor = [130, 85, 85];  // green = good hit
        sendCmd(`HIT:+1`);
      } else {
        gameScore -= 1; 
        if (gameScore < 0) gameScore = 0; 
        
        fakeHitCount += 1; // increment strike count
        backgroundFlashColor = [0, 85, 85]; // red = bad hit
        sendCmd(`HIT:-1`);

        if (fakeHitCount >= 3) {
          isGameOver = true;
          sendCmd(`HIT:G-OVER`);
          sendCmd(`UPDATE:0,1`);
          return;
        }
      }

      // level transitions at 5 point intervals
      let targetedLevel = floor(gameScore / 5) + 1;
      if (targetedLevel < 1) targetedLevel = 1;
      gameLevel = targetedLevel;
      
      // AI use: keep OLED in sync
      sendCmd(`UPDATE:${gameScore},${gameLevel}`);
    } 
    else if (moleTimer <= 0) {
      // go back to hiding if player missed it
      moleState = "hiding";
      stateTimer = 0;
      moleHoleIndex = -1;
    }
  } 
  else if (moleState === "whacked") {
    if (stateTimer > 15) { 
      moleState = "hiding";
      stateTimer = 0;
      moleHoleIndex = -1;
    }
  }

  // AI use: decay smoothly toward 0 every frame so doesn't trigger whacks on subsequent frames
  shakePulse = lerp(shakePulse, 0, 0.05);
}

function getJoystickQuadrant() {
  // AI use: treat binary comparisons as bit flags to map directions to the four quadrants
  let isMovingRight = (joyX < 512);
  let isMovingDown  = (joyY > 512);
  
  let targetQuad = 0;
  if (isMovingRight) targetQuad += 1; // bit 0 = holes 1 & 3
  if (isMovingDown)  targetQuad += 2; // bit 1 = holes 2 & 3
  
  return targetQuad;
}

// talks to esp32
function sendCmd(cmd) { 
  if (serial && serial.isOpen()) serial.writeLine(cmd); 
}

// AI use for the graphics
function drawHolesAndMoles() {
  for (let i = 0; i < holes.length; i++) {
    let h = holes[i];

    fill(210, 60, 12);
    ellipse(h.x, h.y + 40, 220, 60);
    fill(210, 70, 5);
    ellipse(h.x, h.y + 40, 190, 45);

    if (moleHoleIndex === i) {
      if (moleState === "up") {
        if (moleType === "real") {
          fill(28, 75, 75); 
        } else {
          fill(0, 85, 75);  
        }
        
        rect(h.x, h.y - 10, 110, 110, 55, 55, 10, 10);
        
        fill(0, 0, 95);
        ellipse(h.x - 22, h.y - 25, 26, 26);
        ellipse(h.x + 22, h.y - 25, 26, 26);
        fill(0, 0, 5);
        ellipse(h.x - 22, h.y - 25, 8, 8);
        ellipse(h.x + 22, h.y - 25, 8, 8);
        stroke(0, 0, 5); 
        strokeWeight(3);
        line(h.x - 9, h.y - 25, h.x + 9, h.y - 25); 
        noStroke();

        if (moleType === "real") {
          fill(350, 45, 95);
          ellipse(h.x, h.y - 5, 22, 14);
        } else {
          fill(60, 90, 95); 
          triangle(h.x - 10, h.y - 10, h.x, h.y + 8, h.x + 10, h.y - 10);
        }
      } 
      else if (moleState === "whacked") {
        fill(0, 0, 15);
        rect(h.x, h.y + 15, 120, 60, 30, 30, 5, 5);
        fill(0, 0, 95); textSize(24);
        text(moleType === "real" ? "X X" : "O_O", h.x, h.y + 10);
      }
    }
  }
}

// AI use for the graphics
function drawCrosshairAndHammer() {
  let targetIndex = selectedHole;
  let currentTarget = holes[targetIndex];

  stroke(0, 85, 95); strokeWeight(4); noFill();
  ellipse(currentTarget.x, currentTarget.y, 160, 160);
  line(currentTarget.x - 100, currentTarget.y, currentTarget.x + 100, currentTarget.y);
  line(currentTarget.x, currentTarget.y - 100, currentTarget.x, currentTarget.y + 100);
  noStroke();

  // Keeps rotation centered on the target hole
  push();
  translate(currentTarget.x, currentTarget.y);
  if (joyY < 250 || moleState === "whacked") {
    rotate(0.35); // tilt a little forward to strike
  } else {
    rotate(-0.15 + sin(t * 0.5) * 0.05); // gentle sway using sin wave
  }

  fill(35, 30, 45);
  rect(65, -35, 20, 90, 4);
  fill(0, 80, 80);
  rect(65, -80, 90, 55, 8);
  pop();
}

function drawHUDOverlay() {
  fill(210, 75, 15, 180);
  rect(width / 2, 50, 460, 65, 12);
  
  fill(0, 0, 100); textSize(24);
  text(`SCORE: ${gameScore}`, width / 2 - 110, 50);
  
  fill(45, 85, 98); textSize(26);
  text(`LEVEL: ${gameLevel}`, width / 2 + 110, 50);
}

function drawGameOverScreen() {
  background(0, 85, 20); // dark crimson

  fill(0, 85, 95);
  textSize(64);
  text("GAME OVER", width / 2, height * 0.4);

  fill(0, 0, 95);
  textSize(24);
  text(`Final Score: ${gameScore}  |  Reached Level: ${gameLevel}`, width / 2, height * 0.52);
  
  fill(35, 80, 95); textSize(18);
}

function onSerialDataReceived(eventSender, newData) {
  let parts = trim(newData).split(",");
  if (parts.length < 6) return;

  let parsedJX = parseInt(parts[0]);
  let parsedJY = parseInt(parts[1]);
  let parsedSW = parseInt(parts[2]);
  let parsedAx = parseFloat(parts[3]);
  let parsedAy = parseFloat(parts[4]);
  let parsedAz = parseFloat(parts[5]);

  // only overwrite globals if parsed value is valid
  if (!isNaN(parsedJX)) joyX = parsedJX;
  if (!isNaN(parsedJY)) joyY = parsedJY;

  if (!isNaN(parsedAx) && !isNaN(parsedAy) && !isNaN(parsedAz)) {
    accelX = parsedAx; accelY = parsedAy; accelZ = parsedAz;
    
    // AI use: compute euclidean magnitude of 3 axis vector to track how it changes frame to frame
    // pure tilt produces small deltas, sudden jerk produces large delta
    let mag = sqrt(accelX*accelX + accelY*accelY + accelZ*accelZ);
    let delta = abs(mag - prevAccelMag);
    prevAccelMag = mag;

    shakeDeltas.push(delta);
    if (shakeDeltas.length > 12) shakeDeltas.shift();

    shakeAvg = shakeDeltas.reduce((sum, val) => sum + val, 0) / shakeDeltas.length;
    if (shakeAvg > 0.15) {
      shakePulse = constrain(shakePulse + shakeAvg * 1.5, 0, 1);
    }
  }
}

function onSerialConnectionOpened(e) { 
  if (pHtmlMsg) pHtmlMsg.html("serial connected ✓"); 
}

function onSerialConnectionClosed(e) { 
  if (pHtmlMsg) pHtmlMsg.html("serial disconnected — click to reconnect"); 
  
  // reset game when cable is unplugged so next connection starts clean
  gameScore = 0;
  gameLevel = 1;
  fakeHitCount = 0;
  isGameOver = false;
}

function onSerialErrorOccurred(e,err) { 
  console.log("serial error",err); 
}

function mouseClicked() { 
  if (!serial.isOpen()){
    serial.connectAndOpen(null,serialOptions); 
  }
}

function windowResized() { 
  resizeCanvas(windowWidth, windowHeight); initGridGeometry(); 
}
