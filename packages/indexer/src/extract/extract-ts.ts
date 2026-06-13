import { createHash } from "node:crypto";
import ts from "typescript";
import type { BlockType, ExtractedBlock } from "../code-block.js";

// .test/.spec in any js/ts flavor → the whole file is test code.
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

// Component heuristic: a PascalCase declaration in a JSX-capable file. JSX
// cannot appear in plain .ts, so PascalCase + tsx/jsx is a strong signal.
function isComponentName(name: string, scriptKind: ts.ScriptKind): boolean {
  return (
    isPascalCase(name) && (scriptKind === ts.ScriptKind.TSX || scriptKind === ts.ScriptKind.JSX)
  );
}

// Route heuristic (best-effort, spec §4): a function-like declaration in a file
// under a `routes/` or `api/` directory. Decorator / `app.<verb>(` detection is
// deferred; non-matches fall back to function.
const ROUTE_PATH_RE = /(^|\/)(routes|api)\//;

function functionLikeType(name: string, scriptKind: ts.ScriptKind, isRoute: boolean): BlockType {
  if (isComponentName(name, scriptKind)) return "component";
  if (isRoute) return "route";
  return "function";
}

function tokenize(name: string): string[] {
  return [
    ...new Set(
      name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length > 0),
    ),
  ];
}

function collectCalls(node: ts.Node): string[] {
  const calls = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee)) calls.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) calls.add(callee.name.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return [...calls];
}

function collectImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

export function extractTs(filePath: string, source: string): ExtractedBlock[] {
  const scriptKind = scriptKindFor(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const fileImports = collectImports(sourceFile);
  const isTest = TEST_FILE_RE.test(filePath);
  const isRoute = ROUTE_PATH_RE.test(filePath);
  const blocks: ExtractedBlock[] = [];

  const add = (
    positionNode: ts.Node,
    name: string,
    baseType: BlockType,
    exported: boolean,
  ): void => {
    const text = positionNode.getText(sourceFile);
    const startLine =
      sourceFile.getLineAndCharacterOfPosition(positionNode.getStart(sourceFile)).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(positionNode.getEnd()).line + 1;
    const block: ExtractedBlock = {
      filePath,
      startLine,
      endLine,
      blockType: isTest ? "test" : baseType,
      name,
      contentHash: createHash("sha256").update(text).digest("hex"),
      imports: fileImports,
      exports: exported ? [name] : [],
      calls: collectCalls(positionNode),
      calledBy: [],
      keywords: tokenize(name),
    };
    blocks.push(block);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      add(statement, name, functionLikeType(name, scriptKind, isRoute), isExported(statement));
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      add(statement, statement.name.text, "class", isExported(statement));
    } else if (ts.isInterfaceDeclaration(statement)) {
      add(statement, statement.name.text, "schema", isExported(statement));
    } else if (ts.isTypeAliasDeclaration(statement)) {
      add(statement, statement.name.text, "schema", isExported(statement));
    } else if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          const name = declaration.name.text;
          add(declaration, name, functionLikeType(name, scriptKind, isRoute), exported);
        }
      }
    }
  }

  return blocks;
}
