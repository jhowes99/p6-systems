/**
 * Code Parser - Converts various PLC code formats to Ladder IR
 * Supports: Python, Structured Text (ST), Function Block (FB), Ladder Logic
 */

/**
 * Parse Structured Text (ST) code and convert to Ladder IR
 */
export function parseStructuredText(stCode) {
  const rungs = [];
  const lines = stCode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('(*') && !l.startsWith('*'));
  
  for (const line of lines) {
    // Skip comments and declarations
    if (line.startsWith('PROGRAM') || line.startsWith('VAR') || line.startsWith('END_') || 
        line.startsWith('(*') || line.length === 0) {
      continue;
    }

    // Pattern: VAR := EXPR;
    const assignMatch = line.match(/^(\w+)\s*:=\s*(.+?);?$/);
    if (assignMatch) {
      const [, target, exprStr] = assignMatch;
      const cond = parseSTExpression(exprStr);
      rungs.push({
        cond,
        actions: [{ type: "COIL", target }]
      });
      continue;
    }

    // Pattern: IF EXPR THEN VAR := TRUE; END_IF;
    const ifSetMatch = line.match(/^IF\s+(.+?)\s+THEN\s+(\w+)\s*:=\s*TRUE;?\s*END_IF;?$/i);
    if (ifSetMatch) {
      const [, exprStr, target] = ifSetMatch;
      const cond = parseSTExpression(exprStr);
      rungs.push({
        cond,
        actions: [{ type: "SET", target }]
      });
      continue;
    }

    // Pattern: IF EXPR THEN VAR := FALSE; END_IF;
    const ifResetMatch = line.match(/^IF\s+(.+?)\s+THEN\s+(\w+)\s*:=\s*FALSE;?\s*END_IF;?$/i);
    if (ifResetMatch) {
      const [, exprStr, target] = ifResetMatch;
      const cond = parseSTExpression(exprStr);
      rungs.push({
        cond,
        actions: [{ type: "RESET", target }]
      });
      continue;
    }
  }

  return {
    language: "ladder",
    networks: [{ rungs }]
  };
}

/**
 * Parse ST expression to IR expression
 */
function parseSTExpression(expr) {
  expr = expr.trim();
  
  // Remove outer parentheses
  while (expr.startsWith('(') && expr.endsWith(')')) {
    expr = expr.slice(1, -1).trim();
  }

  // Variable reference
  if (/^[IQM]\d+$/.test(expr)) {
    return { var: expr };
  }

  // NOT expression
  const notMatch = expr.match(/^NOT\s+(.+)$/i);
  if (notMatch) {
    return { op: "NOT", x: parseSTExpression(notMatch[1]) };
  }

  // AND expression (find outermost AND)
  let depth = 0;
  for (let i = expr.length - 1; i >= 0; i--) {
    if (expr[i] === ')') depth++;
    else if (expr[i] === '(') depth--;
    else if (depth === 0 && expr.substring(i - 2, i + 1).toUpperCase() === 'AND') {
      const left = expr.substring(0, i - 2).trim();
      const right = expr.substring(i + 3).trim();
      return {
        op: "AND",
        a: parseSTExpression(left),
        b: parseSTExpression(right)
      };
    }
  }

  // OR expression (find outermost OR)
  depth = 0;
  for (let i = expr.length - 1; i >= 0; i--) {
    if (expr[i] === ')') depth++;
    else if (expr[i] === '(') depth--;
    else if (depth === 0 && expr.substring(i - 1, i + 1).toUpperCase() === 'OR') {
      const left = expr.substring(0, i - 1).trim();
      const right = expr.substring(i + 2).trim();
      return {
        op: "OR",
        a: parseSTExpression(left),
        b: parseSTExpression(right)
      };
    }
  }

  // Fallback: treat as variable
  return { var: expr };
}

/**
 * Parse Python code and convert to Ladder IR
 * Simple pattern matching for common PLC-like Python patterns
 */
export function parsePython(pyCode) {
  const rungs = [];
  const lines = pyCode.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and imports
    if (trimmed.startsWith('#') || trimmed.startsWith('import') || trimmed.startsWith('from') || 
        trimmed.startsWith('def ') || trimmed.length === 0) {
      continue;
    }

    // Pattern: Q0 = I0 or Q0
    const simpleAssign = trimmed.match(/^(\w+)\s*=\s*(\w+)\s*(?:or\s+(\w+))?$/i);
    if (simpleAssign) {
      const [, target, left, right] = simpleAssign;
      let cond;
      if (right) {
        cond = { op: "OR", a: { var: left }, b: { var: right } };
      } else {
        cond = { var: left };
      }
      rungs.push({
        cond,
        actions: [{ type: "COIL", target }]
      });
      continue;
    }

    // Pattern: Q0 = I0 and not I1
    const andNotMatch = trimmed.match(/^(\w+)\s*=\s*(\w+)\s+and\s+not\s+(\w+)$/i);
    if (andNotMatch) {
      const [, target, left, right] = andNotMatch;
      rungs.push({
        cond: {
          op: "AND",
          a: { var: left },
          b: { op: "NOT", x: { var: right } }
        },
        actions: [{ type: "COIL", target }]
      });
      continue;
    }

    // Pattern: if condition: Q0 = True
    const ifMatch = trimmed.match(/^if\s+(.+?):\s*(\w+)\s*=\s*(True|False)$/i);
    if (ifMatch) {
      const [, condStr, target, value] = ifMatch;
      const cond = parsePythonExpression(condStr);
      const actionType = value.toLowerCase() === 'true' ? "SET" : "RESET";
      rungs.push({
        cond,
        actions: [{ type: actionType, target }]
      });
      continue;
    }
  }

  return {
    language: "ladder",
    networks: [{ rungs }]
  };
}

/**
 * Parse Python expression to IR expression
 */
function parsePythonExpression(expr) {
  expr = expr.trim();
  
  // Variable reference
  if (/^[IQM]\d+$/.test(expr)) {
    return { var: expr };
  }

  // NOT expression
  if (expr.startsWith('not ')) {
    return { op: "NOT", x: parsePythonExpression(expr.substring(4)) };
  }

  // AND expression
  if (expr.includes(' and ')) {
    const parts = expr.split(' and ');
    if (parts.length === 2) {
      return {
        op: "AND",
        a: parsePythonExpression(parts[0]),
        b: parsePythonExpression(parts[1])
      };
    }
  }

  // OR expression
  if (expr.includes(' or ')) {
    const parts = expr.split(' or ');
    if (parts.length === 2) {
      return {
        op: "OR",
        a: parsePythonExpression(parts[0]),
        b: parsePythonExpression(parts[1])
      };
    }
  }

  return { var: expr };
}

/**
 * Parse Function Block (FB) code and convert to Ladder IR
 * Simplified parser for common FB patterns
 */
export function parseFunctionBlock(fbCode) {
  const rungs = [];
  const lines = fbCode.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and declarations
    if (trimmed.startsWith('(*') || trimmed.startsWith('FUNCTION_BLOCK') || 
        trimmed.startsWith('VAR') || trimmed.startsWith('END_') || trimmed.length === 0) {
      continue;
    }

    // Pattern: VAR := EXPR;
    const assignMatch = trimmed.match(/^(\w+)\s*:=\s*(.+?);?$/);
    if (assignMatch) {
      const [, target, exprStr] = assignMatch;
      const cond = parseSTExpression(exprStr); // Reuse ST parser
      rungs.push({
        cond,
        actions: [{ type: "COIL", target }]
      });
    }
  }

  return {
    language: "ladder",
    networks: [{ rungs }]
  };
}

/**
 * Parse Ladder Logic (text representation) and convert to Ladder IR
 * Simple text-based ladder representation parser
 */
export function parseLadderLogic(ladderCode) {
  const rungs = [];
  const lines = ladderCode.split('\n').map(l => l.trim()).filter(l => l);

  for (const line of lines) {
    // Skip comments
    if (line.startsWith('//') || line.startsWith('*') || line.length === 0) {
      continue;
    }

    // Pattern: RUNG: CONDITION -> ACTION
    const rungMatch = line.match(/^RUNG:\s*(.+?)\s*->\s*(.+)$/i);
    if (rungMatch) {
      const [, condStr, actionStr] = rungMatch;
      const cond = parseLadderExpression(condStr);
      const actions = parseLadderActions(actionStr);
      rungs.push({ cond, actions });
      continue;
    }

    // Pattern: VAR := EXPR
    const assignMatch = line.match(/^(\w+)\s*:=\s*(.+)$/);
    if (assignMatch) {
      const [, target, exprStr] = assignMatch;
      const cond = parseLadderExpression(exprStr);
      rungs.push({
        cond,
        actions: [{ type: "COIL", target }]
      });
    }
  }

  return {
    language: "ladder",
    networks: [{ rungs }]
  };
}

/**
 * Parse ladder expression
 */
function parseLadderExpression(expr) {
  expr = expr.trim();
  
  // Variable
  if (/^[IQM]\d+$/.test(expr)) {
    return { var: expr };
  }

  // NOT
  if (expr.startsWith('NOT ') || expr.startsWith('!')) {
    const inner = expr.startsWith('NOT ') ? expr.substring(4) : expr.substring(1);
    return { op: "NOT", x: parseLadderExpression(inner) };
  }

  // AND
  if (expr.includes(' AND ') || expr.includes(' && ')) {
    const sep = expr.includes(' AND ') ? ' AND ' : ' && ';
    const parts = expr.split(sep);
    if (parts.length === 2) {
      return {
        op: "AND",
        a: parseLadderExpression(parts[0]),
        b: parseLadderExpression(parts[1])
      };
    }
  }

  // OR
  if (expr.includes(' OR ') || expr.includes(' || ')) {
    const sep = expr.includes(' OR ') ? ' OR ' : ' || ';
    const parts = expr.split(sep);
    if (parts.length === 2) {
      return {
        op: "OR",
        a: parseLadderExpression(parts[0]),
        b: parseLadderExpression(parts[1])
      };
    }
  }

  return { var: expr };
}

/**
 * Parse ladder actions
 */
function parseLadderActions(actionStr) {
  const actions = [];
  const parts = actionStr.split(',').map(p => p.trim());

  for (const part of parts) {
    if (part.startsWith('SET ')) {
      actions.push({ type: "SET", target: part.substring(4) });
    } else if (part.startsWith('RESET ')) {
      actions.push({ type: "RESET", target: part.substring(6) });
    } else {
      actions.push({ type: "COIL", target: part });
    }
  }

  return actions;
}

/**
 * Auto-detect code format and parse
 */
export function parseCode(code, filename) {
  const ext = filename ? filename.split('.').pop().toLowerCase() : '';
  const codeLower = code.toLowerCase();

  // Detect by extension or content
  if (ext === 'st' || ext === 'iec' || codeLower.includes('program') && codeLower.includes('end_program')) {
    return parseStructuredText(code);
  } else if (ext === 'py' || codeLower.includes('def ') || codeLower.includes('import ')) {
    return parsePython(code);
  } else if (ext === 'fb' || codeLower.includes('function_block')) {
    return parseFunctionBlock(code);
  } else if (ext === 'ld' || codeLower.includes('rung:') || codeLower.includes('ladder')) {
    return parseLadderLogic(code);
  } else {
    // Try ST first (most common), then Python
    try {
      return parseStructuredText(code);
    } catch {
      try {
        return parsePython(code);
      } catch {
        throw new Error('Unable to detect code format. Please ensure file has correct extension (.st, .py, .fb, .ld)');
      }
    }
  }
}
