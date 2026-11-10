# Tilt Flight

Mobile flight simulator that runs in the browser. Tilt your phone to fly.

- Tilt the device down: nose down, descend. Tilt up: climb. Tilt sideways: bank and turn.
- Hold the right side of the screen to rev the engine. Hold the left side to ease off.
- Three planes: cargo hauler, airliner, fighter jet. Each has its own dashboard, handling and engine sound.
- Clouds, rain, storm with lightning, fog, sunset. Weather changes by itself, or tap the cloud button.
- iOS asks for motion permission on the Start tap. If sensors are missing or denied, an on-screen joystick appears. Desktop: arrow keys / WASD, Shift to rev.

No build step and no assets: `index.html`, `style.css`, `game.js`. Sound is synthesized with WebAudio.
Deep link for testing: `?plane=fighter&weather=storm&go=1`.
