// Structured I/O list export - real-world export path
// See PRODUCT_CONSTRAINTS.md - one solid export path that matches evaluator behavior exactly

/**
 * Export structured I/O list from project IR
 * Format: CSV with columns: Tag, Address, Type, Description, Group
 */
export function exportIOList(ir) {
  const ioMap = ir?.ioMap || {};
  const lines = ["Tag,Address,Type,Description,Group"];
  
  for (const [tag, address] of Object.entries(ioMap)) {
    const addr = String(address);
    const type = addr.startsWith("I") ? "Input" : 
                 addr.startsWith("Q") ? "Output" : 
                 addr.startsWith("M") ? "Memory" : "Unknown";
    
    // Determine group (safety vs control)
    const tagUpper = String(tag).toUpperCase();
    const group = (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
                   tagUpper.includes("EMERGENCY") || tagUpper.includes("SAFETY") ||
                   tagUpper.includes("OVERLOAD")) ? "Safety" : "Control";
    
    const description = tag; // Use tag as description, can be enhanced
    lines.push(`"${tag}","${address}","${type}","${description}","${group}"`);
  }
  
  return lines.join("\n");
}

/**
 * Export I/O list as JSON (structured format)
 */
export function exportIOListJSON(ir) {
  const ioMap = ir?.ioMap || {};
  const entries = [];
  
  for (const [tag, address] of Object.entries(ioMap)) {
    const addr = String(address);
    const type = addr.startsWith("I") ? "Input" : 
                 addr.startsWith("Q") ? "Output" : 
                 addr.startsWith("M") ? "Memory" : "Unknown";
    
    const tagUpper = String(tag).toUpperCase();
    const group = (tagUpper.includes("ESTOP") || tagUpper.includes("E-STOP") || 
                   tagUpper.includes("EMERGENCY") || tagUpper.includes("SAFETY") ||
                   tagUpper.includes("OVERLOAD")) ? "Safety" : "Control";
    
    entries.push({
      tag,
      address,
      type,
      description: tag,
      group
    });
  }
  
  return {
    ioList: entries,
    metadata: {
      exportedAt: new Date().toISOString(),
      totalInputs: entries.filter(e => e.type === "Input").length,
      totalOutputs: entries.filter(e => e.type === "Output").length,
      totalMemory: entries.filter(e => e.type === "Memory").length
    }
  };
}
