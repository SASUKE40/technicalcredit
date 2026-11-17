import {
  javaPackageOf,
  renderAnnotationTypeSource,
  requiredImport,
} from '@/comment/annotationType';

describe('javaPackageOf', () => {
  test('reads the package declaration', () => {
    expect(javaPackageOf('/* x */\npackage com.acme.shop;\nclass A {}')).toBe(
      'com.acme.shop',
    );
  });

  test('returns null for the default package', () => {
    expect(javaPackageOf('class A {}')).toBeNull();
  });
});

describe('renderAnnotationTypeSource', () => {
  test('declares the annotation type in the given package', () => {
    const source = renderAnnotationTypeSource('com.acme');
    expect(source.startsWith('package com.acme;\n')).toBe(true);
    expect(source).toContain('public @interface TechnicalCredit {');
    expect(source).toContain('String[] designPatterns() default {};');
    expect(source).toContain('@Repeatable(TechnicalCredit.List.class)');
  });

  test('omits the package line for the default package', () => {
    expect(renderAnnotationTypeSource(null)).not.toContain('package');
  });
});

describe('requiredImport', () => {
  const FILE = [
    'package com.acme.shop;',
    '',
    'import java.util.List;',
    '',
    'class A {}',
  ].join('\n');

  test('needs no import in the same package', () => {
    expect(requiredImport(FILE, 'com.acme.shop')).toBeNull();
  });

  test('adds an import after the last import', () => {
    expect(requiredImport(FILE, 'com.acme.tc')).toEqual({
      line: 3,
      text: 'import com.acme.tc.TechnicalCredit;\n',
    });
  });

  test('skips an existing explicit or wildcard import', () => {
    expect(
      requiredImport(
        `${FILE}\nimport com.acme.tc.TechnicalCredit;`,
        'com.acme.tc',
      ),
    ).toBeNull();
    expect(
      requiredImport(`${FILE}\nimport com.acme.tc.*;`, 'com.acme.tc'),
    ).toBeNull();
  });

  test('adds an import after the package line when there are no imports', () => {
    expect(
      requiredImport('package com.acme.shop;\n\nclass A {}', 'com.acme.tc'),
    ).toEqual({ line: 1, text: '\nimport com.acme.tc.TechnicalCredit;\n' });
  });
});
