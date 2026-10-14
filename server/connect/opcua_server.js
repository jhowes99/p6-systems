/**
 * P6 Connect — OPC UA server exposing runtime signals (Phase 6).
 * Namespace paths: P6Systems/Projects/<ProjectName>/<SignalTag>
 *
 * Enable with ENABLE_OPCUA=1. Uses node-opcua when installed.
 */

let _server = null;
let _status = {
  enabled: false,
  running: false,
  endpoint: null,
  nodeCount: 0,
  error: null,
  mode: "SIMULATION"
};

export function getOpcUaStatus() {
  return { ..._status };
}

/**
 * @param {{ bridge: import('../plc/project_binding.js').ProjectRuntimeBridge, port?: number }} opts
 */
export async function startOpcUaServer({ bridge, port = 4840 } = {}) {
  if (process.env.ENABLE_OPCUA !== "1") {
    _status = {
      enabled: false,
      running: false,
      endpoint: null,
      nodeCount: 0,
      error: null,
      mode: "SIMULATION",
      note: "Set ENABLE_OPCUA=1 to start OPC UA server"
    };
    return _status;
  }

  try {
    const opcua = await import("node-opcua");
    const {
      OPCUAServer,
      Variant,
      DataType,
      StatusCodes,
      makeApplicationUrn,
      nodesets
    } = opcua;

    const endpoint = `opc.tcp://0.0.0.0:${port}`;
    const server = new OPCUAServer({
      port: Number(port),
      resourcePath: "/UA/P6Systems",
      buildInfo: {
        productName: "P6 Systems Runtime OPC UA",
        buildNumber: "6",
        buildDate: new Date()
      },
      serverInfo: {
        applicationUri: makeApplicationUrn(process.env.HOSTNAME || "p6", "P6Systems"),
        productUri: "urn:p6systems:runtime",
        applicationName: { text: "P6 Systems", locale: "en" }
      },
      nodeset_filename: [nodesets.standard]
    });

    await server.initialize();
    const addressSpace = server.engine.addressSpace;
    const namespace = addressSpace.registerNamespace("http://p6systems.io/UA/");

    const projectName = (bridge.project?.name || "WaterTransfer").replace(/\s+/g, "");
    const root = namespace.addObject({
      organizedBy: addressSpace.rootFolder.objects,
      browseName: "P6Systems"
    });
    const projects = namespace.addObject({ organizedBy: root, browseName: "Projects" });
    const projectNode = namespace.addObject({ organizedBy: projects, browseName: projectName });

    let nodeCount = 0;
    const variables = [];

    for (const sig of bridge.listSignals()) {
      const pathTag = String(sig.tag).replace(/\./g, "/");
      // Stable browse path segments under equipment-like folders when tag has dots
      const parts = String(sig.tag).split(".");
      let parent = projectNode;
      for (let i = 0; i < parts.length - 1; i++) {
        const existing = parent.getFolderElementByName?.(parts[i]);
        // simplify: flat variables named with full tag
      }
      const dataType = sig.dataType === "REAL" || sig.dataType === "INT" ? DataType.Double : DataType.Boolean;
      const v = namespace.addVariable({
        componentOf: projectNode,
        browseName: sig.tag,
        nodeId: `ns=${namespace.index};s=P6Systems/Projects/${projectName}/${sig.tag}`,
        dataType,
        minimumSamplingInterval: 100,
        value: {
          get: () => {
            const live = bridge.getSignal(sig.tag);
            const raw = live?.simulationOverride ? live.overrideValue : live?.currentValue;
            const value = dataType === DataType.Double ? Number(raw) || 0 : !!raw;
            return new Variant({ dataType, value });
          }
        }
      });
      variables.push(v);
      nodeCount += 1;
    }

    // Refresh values each second from bridge (subscriptions read via getter)
    server.on("post_start", () => {
      console.log(`P6 OPC UA listening on opc.tcp://0.0.0.0:${port}/UA/P6Systems`);
    });

    await server.start();
    _server = server;
    _status = {
      enabled: true,
      running: true,
      endpoint: `opc.tcp://localhost:${port}/UA/P6Systems`,
      endpointDocker: `opc.tcp://host.docker.internal:${port}/UA/P6Systems`,
      namespace: "P6Systems",
      pathExample: `P6Systems/Projects/${projectName}/P101/RunningFeedback`,
      nodeCount,
      mode: "SIMULATION",
      mappingNote: "NodeId s=P6Systems/Projects/<Project>/<SignalTag> — stable across restarts for same project name/tags"
    };
    return _status;
  } catch (e) {
    _status = {
      enabled: true,
      running: false,
      endpoint: null,
      nodeCount: 0,
      error: String(e?.message || e),
      mode: "SIMULATION",
      note: "Install node-opcua dependency or check ENABLE_OPCUA"
    };
    console.error("OPC UA start failed:", e?.message || e);
    return _status;
  }
}

export async function stopOpcUaServer() {
  if (_server) {
    try { await _server.shutdown(); } catch (_) { /* ignore */ }
    _server = null;
  }
  _status.running = false;
}
