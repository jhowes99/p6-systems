(* ============================================================
   P6 Systems — Preliminary IEC 61131-3 Structured Text
   Project: Engineer Smoke Water Transfer
   ProjectId: prj_engineer_smoke
   ModelVersion: 1
   GeneratedAt: 2026-10-13T04:48:35.369Z
   VendorTarget: iec61131-3
   Classification: ENGINEERING_INFERENCE (preliminary)
   ----------------------------------------------------------
   HONESTY:
   - Not claimed deployable to every PLC vendor/runtime.
   - Requires engineer review/approval before any plant use.
   - Physical I/O addresses are NOT assigned here.
   - Simulated E-stop is model behavior only — not certified safety.
   - Safety / SIL functions are NOT inferred from drawing geometry.
   ============================================================ *)

PROGRAM P6_PreliminaryControls
VAR
  LSH101_High : BOOL := FALSE; (* LSH101.High · ENGINEER_APPROVED · addr=UNASSIGNED *)
  ESTOP101_Healthy : BOOL := FALSE; (* ESTOP101.Healthy · ENGINEER_APPROVED · addr=UNASSIGNED *)
  XV101_OpenCommand : BOOL := FALSE; (* XV101.OpenCommand · ENGINEER_APPROVED · addr=UNASSIGNED *)
  XV101_OpenedFeedback : BOOL := FALSE; (* XV101.OpenedFeedback · ENGINEER_APPROVED · addr=UNASSIGNED *)
  XV101_ClosedFeedback : BOOL := FALSE; (* XV101.ClosedFeedback · ENGINEER_APPROVED · addr=UNASSIGNED *)
  P101_RunCommand : BOOL := FALSE; (* P101.RunCommand · ENGINEER_APPROVED · addr=UNASSIGNED *)
  P101_RunningFeedback : BOOL := FALSE; (* P101.RunningFeedback · ENGINEER_APPROVED · addr=UNASSIGNED *)
  P101_Fault : BOOL := FALSE; (* P101.Fault · ENGINEER_APPROVED · addr=UNASSIGNED *)
  M101_Energize : BOOL := FALSE; (* M101.Energize · ENGINEER_APPROVED · addr=UNASSIGNED *)
  M101_Fault : BOOL := FALSE; (* M101.Fault · ENGINEER_APPROVED · addr=UNASSIGNED *)
  P101_SafeState : BOOL := FALSE; (* P101.SafeState · ENGINEERING_INFERENCE · addr=UNASSIGNED *)
  TransferPermissive : BOOL := FALSE;
  TransferRunning : BOOL := FALSE;
  OperatorStart : BOOL := FALSE; (* HMI / command — bind in Runtime or vendor HMI *)
  OperatorStop : BOOL := FALSE;
  SystemReset : BOOL := FALSE;
END_VAR

(* --- Interlocks from CEM (traceable by name) --- *)
(* INTERLOCK LSH101_INHIBIT: High level inhibits transfer *)
(* dataClass=ENGINEER_APPROVED inhibits=P101,M101 *)
IF LSH101_High THEN
  (* High level inhibit — reject / abort transfer *)
  TransferRunning := FALSE;
  P101_RunCommand := FALSE;
  M101_Energize := FALSE;
END_IF;

(* INTERLOCK ESTOP101_SHUTDOWN: E-stop de-energize (sim only) *)
(* dataClass=ENGINEER_APPROVED inhibits=P101,M101,XV101 *)
IF NOT ESTOP101_Healthy THEN
  P101_RunCommand := FALSE;
  P101_SafeState := TRUE;
  M101_Energize := FALSE;
  XV101_OpenCommand := FALSE;
  TransferRunning := FALSE;
END_IF;

(* --- Transfer permissives --- *)
  TransferPermissive := ESTOP101_Healthy AND NOT LSH101_High AND XV101_OpenedFeedback AND NOT P101_Fault AND NOT M101_Fault;
(* Permissive: ESTOP101.Healthy must be TRUE (healthy) *)
(* Inhibit: LSH101.High must be FALSE *)
(* Permissive: XV101.OpenedFeedback valve open feedback *)
(* Permissive: NOT P101.Fault *)
(* Permissive: NOT M101.Fault *)

(* --- Transfer sequence skeleton --- *)
IF OperatorStop OR NOT TransferPermissive THEN
  TransferRunning := FALSE;
ELSIF OperatorStart AND TransferPermissive THEN
  TransferRunning := TRUE;
END_IF;

XV101_OpenCommand := TransferRunning OR XV101_OpenCommand; (* hold open while running — refine per site *)
P101_RunCommand := TransferRunning AND TransferPermissive;
M101_Energize := TransferRunning AND TransferPermissive;

END_PROGRAM
