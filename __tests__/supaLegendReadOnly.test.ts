import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = new URL('../src/utils/SupaLegend.ts', import.meta.url);
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(
  'SupaLegend.ts',
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const propertyName = (property: ts.ObjectLiteralElementLike) => {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) {
    return property.name.text;
  }
  return null;
};

const findProperty = (object: ts.ObjectLiteralExpression, name: string) =>
  object.properties.find((property) => propertyName(property) === name);

const productVariantConfigs: ts.ObjectLiteralExpression[] = [];
const visit = (node: ts.Node) => {
  if (ts.isObjectLiteralExpression(node)) {
    const collection = findProperty(node, 'collection');
    if (
      collection &&
      ts.isPropertyAssignment(collection) &&
      ts.isStringLiteralLike(collection.initializer) &&
      collection.initializer.text === 'ProductVariants'
    ) {
      productVariantConfigs.push(node);
    }
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);

test('ProductVariants Legend sync is read-only while retaining sync-down configuration', () => {
  assert.equal(productVariantConfigs.length, 1);
  const config = productVariantConfigs[0];
  const actions = findProperty(config, 'actions');
  assert.ok(actions && ts.isPropertyAssignment(actions));
  assert.ok(ts.isArrayLiteralExpression(actions.initializer));
  assert.deepEqual(
    actions.initializer.elements.map((element) =>
      ts.isStringLiteralLike(element) ? element.text : null,
    ),
    ['read'],
  );
  assert.ok(findProperty(config, 'select'), 'select must remain configured');
  assert.ok(findProperty(config, 'filter'), 'user filter must remain configured');
  assert.ok(findProperty(config, 'realtime'), 'realtime sync-down must remain configured');
  assert.ok(findProperty(config, 'persist'), 'persisted cache must remain configured');
});

test('SupaLegend no longer exports ProductVariants write helpers', () => {
  const exportedFunctionNames = sourceFile.statements
    .filter(ts.isFunctionDeclaration)
    .filter((statement) =>
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    )
    .map((statement) => statement.name?.text)
    .filter(Boolean);

  assert.equal(exportedFunctionNames.includes('addProductVariant'), false);
  assert.equal(exportedFunctionNames.includes('updateProductVariant'), false);
  assert.equal(exportedFunctionNames.includes('deleteProductVariant'), false);
});
