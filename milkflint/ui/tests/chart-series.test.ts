// Series lines take the theme's dash only where they need telling apart.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seriesDash } from '@/components/charts/series';

test('a series drawn with others takes its theme dash', () => {
  assert.equal(seriesDash('var(--chart-1)', 2), 'var(--mf-chart-1-dash)');
  assert.equal(seriesDash('var(--chart-6)', 3), 'var(--mf-chart-6-dash)');
});

test('a series alone, in a chart whose dashes mean something, or not a chart colour stays solid', () => {
  assert.equal(seriesDash('var(--chart-1)', 1), undefined);
  assert.equal(seriesDash('var(--chart-2)', 2, true), undefined);
  assert.equal(seriesDash('var(--muted-foreground)', 2), undefined);
  assert.equal(seriesDash('var(--chart-7)', 2), undefined);
});

test('a series the theme draws solid gets no dash, so its key stays as the theme draws it', () => {
  const none = { 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none' } as const;
  assert.equal(seriesDash('var(--chart-1)', 3, false, none), undefined);
  // the dash itself, for a chart that writes it as the SVG attribute
  assert.equal(seriesDash('var(--chart-1)', 3, false, { ...none, 1: '5 3' }), '5 3');
  assert.equal(seriesDash('var(--chart-2)', 3, false, { ...none, 1: '5 3' }), undefined);
});
