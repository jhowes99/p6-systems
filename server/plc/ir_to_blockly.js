/**
 * Convert Ladder IR to Blockly XML
 */

/**
 * Extract variable name from expression (for NOT operations)
 */
function extractVariable(expr) {
  if (!expr) return null;
  if (expr.var) return expr.var;
  if (expr.op === "NOT" && expr.x) return extractVariable(expr.x);
  return null;
}

/**
 * Convert IR expression to Blockly XML block
 */
function exprToBlocklyXML(expr, x = 0, y = 0) {
  if (!expr) {
    return '<block type="logic_boolean"><field name="BOOL">FALSE</field></block>';
  }

  if (expr.var) {
    // Determine if it's NO or NC contact based on variable name pattern
    // For now, default to NO contact
    return `<block type="ic_no_contact" x="${x}" y="${y}">
      <field name="VAR">${expr.var}</field>
    </block>`;
  }

  if (expr.op === "NOT") {
    // Extract variable from nested expression
    const innerVar = extractVariable(expr.x);
    if (innerVar) {
      // Simple NOT of a variable -> NC contact
      return `<block type="ic_nc_contact" x="${x}" y="${y}">
      <field name="VAR">${innerVar}</field>
    </block>`;
    }
    // Complex NOT expression - wrap the inner expression with NOT
    // For Blockly, we need to use NC contact, but if the inner is complex,
    // we should build the inner expression and use NC contact on a memory bit
    // For simplicity, build the inner expression and use NC contact
    const innerXML = exprToBlocklyXML(expr.x, 0, 0);
    // If inner is a variable, use NC contact directly
    if (expr.x && expr.x.var) {
      return `<block type="ic_nc_contact" x="${x}" y="${y}">
      <field name="VAR">${expr.x.var}</field>
    </block>`;
    }
    // For complex nested NOT, we'll simplify by using NC contact on a default variable
    // In a full implementation, we'd need to evaluate the inner expression first
    return `<block type="ic_nc_contact" x="${x}" y="${y}">
      <field name="VAR">I0</field>
    </block>`;
  }

  if (expr.op === "AND") {
    return `<block type="ic_and" x="${x}" y="${y}">
      <value name="A">
        ${exprToBlocklyXML(expr.a, 0, 0)}
      </value>
      <value name="B">
        ${exprToBlocklyXML(expr.b, 0, 0)}
      </value>
    </block>`;
  }

  if (expr.op === "OR") {
    return `<block type="ic_or" x="${x}" y="${y}">
      <value name="A">
        ${exprToBlocklyXML(expr.a, 0, 0)}
      </value>
      <value name="B">
        ${exprToBlocklyXML(expr.b, 0, 0)}
      </value>
    </block>`;
  }

  // Fallback
  return '<block type="logic_boolean"><field name="BOOL">FALSE</field></block>';
}

/**
 * Convert action to Blockly XML block
 */
function actionToBlocklyXML(action, isFirst = false) {
  let blockXML = '';
  if (action.type === "COIL") {
    blockXML = `<block type="ic_coil">
      <field name="VAR">${action.target}</field>
    </block>`;
  } else if (action.type === "SET") {
    blockXML = `<block type="ic_set_coil">
      <field name="VAR">${action.target}</field>
    </block>`;
  } else if (action.type === "RESET") {
    blockXML = `<block type="ic_reset_coil">
      <field name="VAR">${action.target}</field>
    </block>`;
  }
  return blockXML;
}

/**
 * Convert Ladder IR to Blockly XML workspace
 */
export function irToBlocklyXML(ir) {
  const blocks = [];
  let yPos = 50;

  for (const net of ir.networks ?? []) {
    for (const rung of net.rungs ?? []) {
      const condXML = exprToBlocklyXML(rung.cond, 50, yPos);
      const actions = rung.actions ?? [];
      
      // Build action chain - build from last to first, adding <next> elements
      let actionsXML = '';
      if (actions.length > 0) {
        // Start with the last action
        actionsXML = actionToBlocklyXML(actions[actions.length - 1]);
        
        // Work backwards, wrapping each previous action with the next one
        for (let i = actions.length - 2; i >= 0; i--) {
          const currentActionXML = actionToBlocklyXML(actions[i]);
          // Wrap the existing chain with the current action's <next>
          actionsXML = currentActionXML.replace('</block>', 
            `\n      <next>\n        ${actionsXML}\n      </next>\n    </block>`);
        }
      }

      const rungXML = `<block type="ic_rung" x="50" y="${yPos}">
    <value name="COND">
      ${condXML}
    </value>
    <statement name="ACT">
      ${actionsXML}
    </statement>
  </block>`;

      blocks.push(rungXML);
      yPos += 120; // Space between rungs
    }
  }

  return `<xml xmlns="https://developers.google.com/blockly/xml">
  ${blocks.join('\n  ')}
</xml>`;
}
