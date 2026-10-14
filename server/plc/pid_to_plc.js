/**
 * P&ID to PLC Code Generator
 * Converts parsed P&ID elements into Ladder IR format
 */

/**
 * Generate Ladder IR from parsed P&ID elements
 */
export function generatePLCFromPID(pidElements) {
  const rungs = [];
  let inputIndex = 0;
  let outputIndex = 0;
  let memoryIndex = 0;

  // Map tags to I/O addresses
  const ioMap = new Map();

  // Assign I/O addresses
  function getInputAddress(tag) {
    if (!ioMap.has(tag)) {
      ioMap.set(tag, `I${inputIndex++}`);
    }
    return ioMap.get(tag);
  }

  function getOutputAddress(tag) {
    if (!ioMap.has(tag)) {
      ioMap.set(tag, `Q${outputIndex++}`);
    }
    return ioMap.get(tag);
  }

  function getMemoryAddress(tag) {
    if (!ioMap.has(tag)) {
      ioMap.set(tag, `M${memoryIndex++}`);
    }
    return ioMap.get(tag);
  }

  // Generate rungs for on/off valves
  for (const valve of pidElements.valves || []) {
    if (valve.type === "on_off") {
      const openInput = getInputAddress(`${valve.tag}_OPEN`);
      const closeInput = getInputAddress(`${valve.tag}_CLOSE`);
      const valveOutput = getOutputAddress(valve.tag);
      const valveState = getMemoryAddress(`${valve.tag}_STATE`);

      // Seal-in logic for valve control
      // Valve opens when OPEN button pressed OR (valve is open AND close not pressed)
      // Valve closes when CLOSE button pressed
      rungs.push({
        cond: {
          op: "OR",
          a: { var: openInput },
          b: {
            op: "AND",
            a: { var: valveState },
            b: { op: "NOT", x: { var: closeInput } }
          }
        },
        actions: [
          { type: "COIL", target: valveState },
          { type: "COIL", target: valveOutput }
        ]
      });

      // Close valve when close button pressed
      rungs.push({
        cond: { var: closeInput },
        actions: [
          { type: "RESET", target: valveState },
          { type: "RESET", target: valveOutput }
        ]
      });
    }
  }

  // Generate rungs for pumps with interlocks
  for (const pump of pidElements.pumps || []) {
    const startInput = getInputAddress(`${pump.tag}_START`);
    const stopInput = getInputAddress(`${pump.tag}_STOP`);
    const pumpOutput = getOutputAddress(pump.tag);
    const pumpState = getMemoryAddress(`${pump.tag}_STATE`);

    // Build interlock condition
    let interlockCond = null;
    if (pump.interlock) {
      // Find the interlock instrument/valve
      const interlockElement = pidElements.tags?.get(pump.interlock);
      if (interlockElement) {
        if (interlockElement.type === "instrument") {
          // For instruments, assume a high/low alarm contact
          const interlockInput = getInputAddress(`${pump.interlock}_OK`);
          interlockCond = { var: interlockInput };
        } else if (interlockElement.type === "valve") {
          // Valve must be in correct position
          const valveState = getMemoryAddress(`${pump.interlock}_STATE`);
          interlockCond = { var: valveState };
        }
      }
    }

    // Pump start/stop with interlock
    // Pump runs when: START pressed OR (pump running AND stop not pressed) AND interlock OK
    let pumpRunCond = {
      op: "OR",
      a: { var: startInput },
      b: {
        op: "AND",
        a: { var: pumpState },
        b: { op: "NOT", x: { var: stopInput } }
      }
    };

    if (interlockCond) {
      pumpRunCond = {
        op: "AND",
        a: pumpRunCond,
        b: interlockCond
      };
    }

    rungs.push({
      cond: pumpRunCond,
      actions: [
        { type: "COIL", target: pumpState },
        { type: "COIL", target: pumpOutput }
      ]
    });

    // Stop pump
    rungs.push({
      cond: { var: stopInput },
      actions: [
        { type: "RESET", target: pumpState },
        { type: "RESET", target: pumpOutput }
      ]
    });
  }

  // Generate rungs for control loops (simplified PID)
  for (const loop of pidElements.controlLoops || []) {
    const sensorInput = getInputAddress(loop.sensor);
    const actuatorOutput = getOutputAddress(loop.actuator);
    const setpointMemory = getMemoryAddress(`${loop.tag}_SETPOINT`);
    const errorMemory = getMemoryAddress(`${loop.tag}_ERROR`);

    // Simplified control: if sensor < setpoint, open valve; else close
    // In a real system, this would be a proper PID algorithm
    rungs.push({
      cond: {
        op: "AND",
        a: { var: sensorInput }, // Simplified: assume sensor gives boolean
        b: { op: "NOT", x: { var: setpointMemory } } // Simplified comparison
      },
      actions: [
        { type: "COIL", target: actuatorOutput }
      ]
    });

    rungs.push({
      cond: {
        op: "AND",
        a: { var: sensorInput },
        b: { var: setpointMemory }
      },
      actions: [
        { type: "RESET", target: actuatorOutput }
      ]
    });
  }

  // Generate rungs for instruments (alarms, status)
  for (const inst of pidElements.instruments || []) {
    const instrumentInput = getInputAddress(inst.tag);
    const highAlarm = getMemoryAddress(`${inst.tag}_HIGH_ALARM`);
    const lowAlarm = getMemoryAddress(`${inst.tag}_LOW_ALARM`);

    // High alarm (simplified - would need actual value comparison)
    rungs.push({
      cond: { var: instrumentInput },
      actions: [
        { type: "COIL", target: highAlarm }
      ]
    });

    // Low alarm
    rungs.push({
      cond: { op: "NOT", x: { var: instrumentInput } },
      actions: [
        { type: "COIL", target: lowAlarm }
      ]
    });
  }

  return {
    language: "ladder",
    networks: [{ rungs }],
    ioMap: Object.fromEntries(ioMap),
    metadata: {
      generatedFrom: "pid",
      elements: {
        instruments: pidElements.instruments?.length || 0,
        valves: pidElements.valves?.length || 0,
        pumps: pidElements.pumps?.length || 0,
        controlLoops: pidElements.controlLoops?.length || 0
      }
    }
  };
}
