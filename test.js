// test.js
try {
    const htmlUtils = require('./htmlutils.js');
    console.log("htmlutils loaded successfully");
  } catch (e) {
    console.error("Error loading htmlutils:", e);
  }
  
  try {
    const { Gateway } = require('./gateway.js');
    console.log("Gateway loaded successfully");
  } catch (e) {
    console.error("Error loading gateway:", e);
  }

  