# OPC UA connection — P6 Runtime → Ignition

| Setting | Dev (Docker Desktop) | Same compose network |
|---------|----------------------|----------------------|
| Connection name | `P6_Runtime` | `P6_Runtime` |
| Endpoint URL | `opc.tcp://host.docker.internal:4840/UA/P6Systems` | `opc.tcp://p6-app:4840/UA/P6Systems` |
| Security | None (lab) / as required | Same |

Confirm P6 first:

```text
GET http://localhost:3000/api/connect/opcua
→ "running": true
```

Namespace root browse name: `P6Systems`  
Project folder: `Projects/WaterTransferSystem`

Perspective template: `ignition/perspective/P6_WaterTransfer/`  
Full import steps: `../README.md`
