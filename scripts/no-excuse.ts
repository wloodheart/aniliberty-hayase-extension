import {
  CommentDirectiveType,
  createScanner,
  isAsExpression,
  isNonNullExpression,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript/unstable/ast"
import { API } from "typescript/unstable/async"

export type NoExcuseRule =
  | "as-any"
  | "as-unknown"
  | "explicit-any"
  | "non-null-assertion"
  | "ts-expect-error"
  | "ts-ignore"

export interface NoExcuseViolation {
  readonly column: number
  readonly filePath: string
  readonly line: number
  readonly rule: NoExcuseRule
}

interface LocatedViolation extends NoExcuseViolation {
  readonly offset: number
}

interface SourceContext {
  readonly filePath: string
  readonly sourceFile: SourceFile
}

function createViolation(
  context: SourceContext,
  offset: number,
  rule: NoExcuseRule,
): LocatedViolation {
  const position = context.sourceFile.getLineAndCharacterOfPosition(offset)

  return {
    column: position.character + 1,
    filePath: context.filePath,
    line: position.line + 1,
    offset,
    rule,
  }
}

function collectDirectiveViolations(context: SourceContext): readonly LocatedViolation[] {
  const scanner = createScanner(false, undefined, context.sourceFile.text)

  while (scanner.scan() !== SyntaxKind.EndOfFile) {
    // Scan to EOF so TypeScript records directive comments.
  }

  return (scanner.getCommentDirectives() ?? []).map((directive) =>
    createViolation(
      context,
      directive.range.pos,
      directive.type === CommentDirectiveType.Ignore ? "ts-ignore" : "ts-expect-error",
    ),
  )
}

function collectAstViolations(context: SourceContext): readonly LocatedViolation[] {
  const violations: LocatedViolation[] = []
  const visit = (node: Node): undefined => {
    if (isAsExpression(node) && node.type.kind === SyntaxKind.AnyKeyword) {
      violations.push(createViolation(context, node.getStart(), "as-any"))
    } else if (isAsExpression(node) && node.type.kind === SyntaxKind.UnknownKeyword) {
      violations.push(createViolation(context, node.getStart(), "as-unknown"))
    } else if (isNonNullExpression(node)) {
      violations.push(createViolation(context, node.getStart(), "non-null-assertion"))
    } else if (
      node.kind === SyntaxKind.AnyKeyword &&
      !(isAsExpression(node.parent) && node.parent.type === node)
    ) {
      violations.push(createViolation(context, node.getStart(), "explicit-any"))
    }

    node.forEachChild(visit)

    return undefined
  }

  visit(context.sourceFile)

  return violations
}

export async function collectNoExcuseViolations(
  filePaths: readonly string[],
): Promise<readonly NoExcuseViolation[]> {
  const api = new API({ cwd: process.cwd() })

  try {
    const snapshot = await api.updateSnapshot({ openFiles: [...filePaths] })

    try {
      const violations = await Promise.all(
        filePaths.map(async (filePath) => {
          const project = await snapshot.getDefaultProjectForFile(filePath)

          if (project === undefined) {
            throw new Error(`TypeScript project unavailable for ${filePath}`)
          }

          const sourceFile = await project.program.getSourceFile(filePath)

          if (sourceFile === undefined) {
            throw new Error(`TypeScript source unavailable for ${filePath}`)
          }

          const context = { filePath, sourceFile }

          return [...collectDirectiveViolations(context), ...collectAstViolations(context)]
        }),
      )

      return violations.flat().sort((left, right) => left.offset - right.offset)
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await api.close()
  }
}
