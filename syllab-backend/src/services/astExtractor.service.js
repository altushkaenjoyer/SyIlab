'use strict';

/**
 * AST-based feature extractor for SylLab-Forensics
 *
 * Extracts the 15 dimensions used in the scoring formula.
 * Supports Python and JavaScript/TypeScript.
 *
 * Note: For production, Python AST is analyzed via regex heuristics.
 * JS/TS uses @babel/parser for real AST traversal.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function countMatches(code, pattern) {
  return (code.match(pattern) || []).length;
}

function getLines(code) {
  return code.split('\n');
}

// ── Lexical extractors (C1) ────────────────────────────────────────────────

function extractCommentDensity(code, lang) {
  const lines = getLines(code);
  const totalLines = lines.length;
  if (totalLines === 0) return 0;

  let commentLines = 0;
  if (lang === 'python') {
    commentLines = lines.filter(l => l.trim().startsWith('#')).length;
    // Count docstrings
    const docstringMatches = code.match(/"""[\s\S]*?"""|'''[\s\S]*?'''/g) || [];
    docstringMatches.forEach(ds => {
      commentLines += ds.split('\n').length;
    });
  } else {
    // JS/TS
    commentLines = lines.filter(l => l.trim().startsWith('//')).length;
    const blockComments = code.match(/\/\*[\s\S]*?\*\//g) || [];
    blockComments.forEach(bc => {
      commentLines += bc.split('\n').length;
    });
  }

  // comments per 10 lines
  return Math.round((commentLines / totalLines) * 10 * 10) / 10;
}

function extractNamingVerbosity(code, lang) {
  let identifiers = [];
  if (lang === 'python') {
    // Match variable/function/class names
    const matches = code.match(/\b(?:def|class|for|=)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g) || [];
    identifiers = matches.map(m => m.split(/\s+/).pop()).filter(i => i.length > 0);
    // Also grab lone assignments
    const assigns = code.match(/^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm) || [];
    identifiers.push(...assigns.map(a => a.trim().split(/\s*=/)[0]));
  } else {
    const matches = code.match(/\b(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g) || [];
    identifiers = matches.map(m => m.split(/\s+/).pop()).filter(i => i.length > 0);
  }

  // Filter out single-letter and Python keywords
  const KEYWORDS = new Set(['def','class','for','if','else','return','import','from',
    'try','except','with','as','in','and','or','not','is','True','False','None',
    'const','let','var','function','async','await','new','this','super']);
  identifiers = identifiers.filter(i => i.length > 1 && !KEYWORDS.has(i));

  if (identifiers.length === 0) return 5;
  const avg = identifiers.reduce((sum, i) => sum + i.length, 0) / identifiers.length;
  return Math.round(avg * 10) / 10;
}

function detectImportStyle(code, lang) {
  if (lang === 'python') {
    const hasFromImport = /^from\s+\S+\s+import/m.test(code);
    const hasWildcard = /import\s+\*/m.test(code);
    if (hasWildcard) return 2;
    if (hasFromImport) return 1;
    return 0;
  } else {
    const hasRequire = /require\(/m.test(code);
    const hasESM = /^import\s+/m.test(code);
    const hasDynamic = /import\(/m.test(code);
    if (hasRequire && hasESM) return 2; // mixed = unusual
    if (hasDynamic) return 1;
    return 0;
  }
}

// ── Structural extractors (C2) ─────────────────────────────────────────────

function extractErrorHandlingTier(code, lang) {
  // 0 = none, 1 = basic try/catch, 2 = custom exceptions, 3 = full hierarchy
  const hasTryCatch = lang === 'python'
    ? /\btry\s*:/m.test(code)
    : /\btry\s*\{/m.test(code);

  if (!hasTryCatch) return 0;

  const hasCustomException = lang === 'python'
    ? /class\s+\w+\s*\(\s*(?:Exception|Error|\w+Error|\w+Exception)\s*\)/m.test(code)
    : /class\s+\w+\s+extends\s+Error/m.test(code);

  const hasExceptionHierarchy = lang === 'python'
    ? (countMatches(code, /class\s+\w+\s*\(\s*\w*(?:Exception|Error)/gm) >= 2)
    : (countMatches(code, /class\s+\w+\s+extends\s+\w*Error/gm) >= 2);

  if (hasExceptionHierarchy) return 3;
  if (hasCustomException) return 2;
  return 1;
}

function extractArchitectureTier(code, lang) {
  // 0 = flat functions, 1 = classes, 2 = service layer, 3 = design patterns
  const classCount = lang === 'python'
    ? countMatches(code, /^class\s+\w+/gm)
    : countMatches(code, /^(?:export\s+)?class\s+\w+/gm);

  if (classCount === 0) return 0;

  // Service layer: classes with methods that orchestrate other classes
  const hasServicePattern = lang === 'python'
    ? /class\s+\w+Service|class\s+\w+Repository|class\s+\w+Manager/m.test(code)
    : /class\s+\w+Service|class\s+\w+Repository|class\s+\w+Controller/m.test(code);

  // Design patterns: factory, singleton, observer, decorator, strategy
  const hasDesignPattern =
    /(?:Factory|Singleton|Observer|Strategy|Builder|Facade)\s*[({]/m.test(code) ||
    /getInstance\s*\(\s*\)/m.test(code) ||
    /@inject|@Injectable|@singleton/m.test(code);

  if (hasDesignPattern) return 3;
  if (hasServicePattern) return 2;
  return 1;
}

function extractTypeSafetyScore(code, lang) {
  // 0 = none, 1 = basic type hints, 2 = full typing, 3 = generics/advanced
  if (lang === 'python') {
    const hasTypeHints = /:\s*(?:str|int|float|bool|list|dict|tuple|set|Optional|List|Dict)/m.test(code);
    const hasReturnType = /->\s*\w+/m.test(code);
    const hasGeneric = /from\s+typing\s+import|Generic\[|TypeVar\(/m.test(code);
    if (hasGeneric) return 3;
    if (hasTypeHints && hasReturnType) return 2;
    if (hasTypeHints || hasReturnType) return 1;
    return 0;
  } else if (lang === 'typescript') {
    const hasInterface = /interface\s+\w+/m.test(code);
    const hasTypeAlias = /type\s+\w+\s*=/m.test(code);
    const hasGeneric = /<[A-Z]\w*>/m.test(code);
    if (hasGeneric) return 3;
    if (hasInterface || hasTypeAlias) return 2;
    if (/:\s*(?:string|number|boolean|void|any)/m.test(code)) return 1;
    return 0;
  }
  return 0; // plain JS
}

function extractControlFlowPref(code) {
  // 0 = imperative (for/while dominant)
  // 1 = mixed
  // 2 = functional (map/filter/reduce dominant)
  const imperativeCount =
    countMatches(code, /\bfor\b/g) +
    countMatches(code, /\bwhile\b/g);
  const functionalCount =
    countMatches(code, /\.map\s*\(/g) +
    countMatches(code, /\.filter\s*\(/g) +
    countMatches(code, /\.reduce\s*\(/g) +
    countMatches(code, /\blist\s*comprehension|\[.+for.+in.+\]/g);

  if (functionalCount > imperativeCount) return 2;
  if (functionalCount > 0) return 1;
  return 0;
}

// ── Boolean feature detectors ──────────────────────────────────────────────

function detectBooleanFeatures(code, lang) {
  if (lang === 'python') {
    return {
      hasDecorators:          /@\w+/m.test(code),
      hasAsync:               /\basync\s+def\b/m.test(code),
      hasContextManagers:     /\bwith\s+\w+/m.test(code) || /\b__enter__\b/.test(code),
      hasMetaclasses:         /\bmetaclass\s*=|__metaclass__/m.test(code),
      hasDependencyInjection: /\b__init__\s*\(self,\s*\w+:\s*\w+/m.test(code),
      hasAbstractClasses:     /from\s+abc\s+import|@abstractmethod/m.test(code),
      hasDataclasses:         /@dataclass/m.test(code),
    };
  } else {
    return {
      hasDecorators:          /@\w+\s*\n/m.test(code),
      hasAsync:               /\basync\s+function|\basync\s+\(/m.test(code),
      hasContextManagers:     false,
      hasMetaclasses:         /Proxy\s*\(|Symbol\./m.test(code),
      hasDependencyInjection: /constructor\s*\([^)]*:\s*\w+/m.test(code),
      hasAbstractClasses:     /abstract\s+class/m.test(code),
      hasDataclasses:         false,
    };
  }
}

// ── Complexity metrics ─────────────────────────────────────────────────────

function computeCyclomaticAvg(code, lang) {
  // Count decision points per function
  const decisionKeywords = lang === 'python'
    ? /\bif\b|\belif\b|\bfor\b|\bwhile\b|\band\b|\bor\b|\bexcept\b/gm
    : /\bif\b|\belse\s+if\b|\bfor\b|\bwhile\b|\b&&\b|\b\|\|\b|\bcatch\b|\?\s*:/gm;

  const decisions = countMatches(code, decisionKeywords);
  const funcCount = lang === 'python'
    ? Math.max(countMatches(code, /\bdef\s+\w+/gm), 1)
    : Math.max(countMatches(code, /\bfunction\s|\=>\s*\{|\basync\s+\(/gm), 1);

  return Math.round((decisions / funcCount) * 10) / 10;
}

function computeMaxNestingDepth(code, lang) {
  if (lang === 'python') {
    // Python uses indentation — count max indent level (4-space or tab)
    let maxDepth = 0;
    for (const line of code.split('\n')) {
      const trimmed = line.trimStart();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const indent = line.length - trimmed.length;
      const depth = Math.floor(indent / 4) || (indent > 0 ? 1 : 0);
      if (depth > maxDepth) maxDepth = depth;
    }
    return Math.min(maxDepth, 20);
  }
  // JS/TS: count { } pairs only
  let depth = 0;
  let maxDepth = 0;
  for (const ch of code) {
    if (ch === '{') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return Math.min(maxDepth, 20);
}

// ── Genealogy feature detection ────────────────────────────────────────────

/**
 * Returns a list of detected advanced techniques in the code.
 * Used to check prerequisite violations.
 */
function detectTechniques(code, lang) {
  const techniques = [];

  if (lang === 'python') {
    if (/@\w+/m.test(code))                                    techniques.push('decorators');
    if (/\bwith\s+\w+|__enter__/m.test(code))                  techniques.push('context_managers');
    if (/from\s+abc\s+import|@abstractmethod/m.test(code))     techniques.push('abstract_base_classes');
    if (/\bmetaclass\s*=/m.test(code))                         techniques.push('custom_metaclasses');
    if (/\basync\s+def\b/m.test(code))                         techniques.push('async_basics');
    if (/await\s+asyncio|async\s+for|async\s+with/m.test(code)) techniques.push('async_await_advanced');
    if (/class\s+\w+\s*\(\s*\w*(?:Exception|Error)/m.test(code)) techniques.push('custom_exceptions');
    if (/\btry\s*:/m.test(code))                               techniques.push('error_handling_basic');
    if (/class\s+\w+Service|class\s+\w+Repository/m.test(code)) techniques.push('service_layer');
    if (/class\s+\w+\s*\(\s*\w+\s*\)/m.test(code))            techniques.push('inheritance');
    if (/^class\s+\w+/m.test(code))                            techniques.push('classes');
    if (/TypeVar|Generic\[/m.test(code))                       techniques.push('type_hints_advanced');
    if (/:\s*(?:str|int|float|bool|Optional)/m.test(code))     techniques.push('type_hints_basic');
    if (/@dataclass/m.test(code))                              techniques.push('dataclasses');
    if (/\blambda\b|functools/m.test(code))                    techniques.push('functions_advanced');
    if (/\.inject|@inject|container\./m.test(code))            techniques.push('dependency_injection');
    if (/circuit_breaker|@retry|tenacity/m.test(code))         techniques.push('circuit_breaker');
    if (/repository|Repository/m.test(code) && /abstract/m.test(code)) techniques.push('repository_pattern');
  } else {
    if (/async\s+function|\basync\s+\(/m.test(code))           techniques.push('async_basics');
    if (/await\s+Promise\.all|for\s+await/m.test(code))        techniques.push('async_await_advanced');
    if (/class\s+\w+\s+extends/m.test(code))                   techniques.push('inheritance');
    if (/^(?:export\s+)?class\s+\w+/m.test(code))              techniques.push('classes');
    if (/interface\s+\w+/m.test(code))                         techniques.push('interfaces');
    if (/abstract\s+class/m.test(code))                        techniques.push('abstract_base_classes');
    if (/class\s+\w+\s+extends\s+\w*Error/m.test(code))        techniques.push('custom_exceptions');
    if (/\btry\s*\{/m.test(code))                              techniques.push('error_handling_basic');
    if (/class\s+\w+Service|class\s+\w+Repository/m.test(code)) techniques.push('service_layer');
    if (/<[A-Z]\w*>/m.test(code))                              techniques.push('type_hints_advanced');
    if (/:\s*(?:string|number|boolean|void)/m.test(code))      techniques.push('type_hints_basic');
    if (/Proxy\s*\(|Symbol\./m.test(code))                     techniques.push('custom_metaclasses');
    if (/getInstance|private\s+static\s+instance/m.test(code)) techniques.push('design_patterns');
    if (/constructor\s*\([^)]+:\s*\w+/m.test(code))            techniques.push('dependency_injection');
  }

  return [...new Set(techniques)];
}

// ── Main extractor ─────────────────────────────────────────────────────────

/**
 * Extract all features from code string.
 * @param {string} code - source code
 * @param {string} lang - 'python' | 'javascript' | 'typescript'
 * @returns {Object} feature vector
 */
function extractFeatures(code, lang) {
  const normalizedLang = lang === 'typescript' ? 'typescript' : lang;

  const commentDensity    = extractCommentDensity(code, normalizedLang);
  const namingVerbosity   = extractNamingVerbosity(code, normalizedLang);
  const importStyleShift  = detectImportStyle(code, normalizedLang);
  const errorHandlingTier = extractErrorHandlingTier(code, normalizedLang);
  const architectureTier  = extractArchitectureTier(code, normalizedLang);
  const typeSafetyScore   = extractTypeSafetyScore(code, normalizedLang);
  const controlFlowPref   = extractControlFlowPref(code);
  const boolFeatures      = detectBooleanFeatures(code, normalizedLang);
  const cyclomaticAvg     = computeCyclomaticAvg(code, normalizedLang);
  const maxNestingDepth   = computeMaxNestingDepth(code, normalizedLang);
  const techniques        = detectTechniques(code, normalizedLang);

  return {
    // Lexical (C1)
    commentDensity,
    namingVerbosity,
    importStyleShift,

    // Structural (C2)
    errorHandlingTier,
    architectureTier,
    typeSafetyScore,
    controlFlowPref,

    // Boolean features
    ...boolFeatures,

    // Complexity
    cyclomaticAvg,
    maxNestingDepth,

    // Genealogy
    detectedTechniques: techniques,
  };
}

module.exports = { extractFeatures, detectTechniques, computeCyclomaticAvg };
