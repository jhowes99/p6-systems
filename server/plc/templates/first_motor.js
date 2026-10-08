// "First Motor" template - demonstrates end-to-end workflow
// Creates: Motor, Start pushbutton, Stop pushbutton, E-Stop
// Must work end-to-end without editing logic

export function createFirstMotorTemplate() {
  return {
    ir: {
      language: "ladder",
      networks: [
        {
          rungs: [
            {
              // Motor ON rung: Start PB AND NOT Stop PB AND E-Stop (E-Stop must be ON/normal)
              cond: {
                op: "AND",
                a: { var: "I0" }, // Start pushbutton
                b: {
                  op: "AND",
                  a: { op: "NOT", x: { var: "I1" } }, // NOT Stop pushbutton
                  b: { var: "I2" } // E-Stop (must be ON/normal to allow operation)
                }
              },
              actions: [
                { type: "COIL", target: "Q0" } // Motor output
              ]
            },
            {
              // Seal-in: Motor output AND NOT Stop PB AND E-Stop
              cond: {
                op: "AND",
                a: { var: "Q0" }, // Motor output (seal-in)
                b: {
                  op: "AND",
                  a: { op: "NOT", x: { var: "I1" } }, // NOT Stop pushbutton
                  b: { var: "I2" } // E-Stop
                }
              },
              actions: [
                { type: "COIL", target: "Q0" } // Motor output
              ]
            }
          ]
        }
      ],
      ioMap: {
        "Start_PB": "I0",
        "Stop_PB": "I1",
        "E_Stop": "I2",
        "Motor": "Q0"
      },
      metadata: {
        goal: "Control a motor with Start/Stop pushbuttons and E-Stop safety",
        template: "first_motor",
        description: "Basic motor control with start, stop, and emergency stop. Demonstrates seal-in logic and safety chain."
      }
    },
    devices: [
      {
        id: "motor1",
        type: "motor",
        name: "Motor",
        tag: "Motor",
        address: "Q0",
        x: 400,
        y: 200
      },
      {
        id: "start_pb",
        type: "pushbutton",
        name: "Start Pushbutton",
        tag: "Start_PB",
        address: "I0",
        x: 100,
        y: 150,
        style: "start"
      },
      {
        id: "stop_pb",
        type: "pushbutton",
        name: "Stop Pushbutton",
        tag: "Stop_PB",
        address: "I1",
        x: 100,
        y: 250,
        style: "stop"
      },
      {
        id: "estop",
        type: "estop",
        name: "Emergency Stop",
        tag: "E_Stop",
        address: "I2",
        x: 100,
        y: 350,
        style: "estop"
      }
    ]
  };
}
