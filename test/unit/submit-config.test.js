/* eslint-env mocha */
import assert from 'assert';
import DocBasedFormToAF from '../../blocks/form/transform.js';

function sheetWith(submitRow) {
  return {
    total: 2,
    offset: 0,
    limit: 2,
    ':type': 'sheet',
    data: [
      { Name: 'f1', Type: 'text', Label: 'Field 1' },
      { Name: 'submit', Type: 'submit', Label: 'Sign Up', ...submitRow },
    ],
  };
}

describe('Submit button redirect/thank-you configuration', () => {
  describe('Standard behaviour', () => {
    it('sets formDef.redirectUrl when the sheet has a Redirect URL', () => {
      const sheet = sheetWith({ 'Redirect URL': 'https://example.com/thanks' });
      const formDef = new DocBasedFormToAF().transform(sheet);

      assert.strictEqual(formDef.redirectUrl, 'https://example.com/thanks');
      assert.strictEqual(formDef.thankYouMsg, undefined);
    });

    it('sets formDef.thankYouMsg when the sheet has a Thank You Message', () => {
      const sheet = sheetWith({ 'Thank You Message': 'Thanks for signing up!' });
      const formDef = new DocBasedFormToAF().transform(sheet);

      assert.strictEqual(formDef.thankYouMsg, 'Thanks for signing up!');
      assert.strictEqual(formDef.redirectUrl, undefined);
    });
  });

  describe('Edge cases', () => {
    it('prefers Redirect URL when both are set', () => {
      const sheet = sheetWith({
        'Redirect URL': 'https://example.com/thanks',
        'Thank You Message': 'Thanks for signing up!',
      });
      const formDef = new DocBasedFormToAF().transform(sheet);

      assert.strictEqual(formDef.redirectUrl, 'https://example.com/thanks');
      assert.strictEqual(formDef.thankYouMsg, undefined);
    });

    it('leaves both undefined when neither column is set', () => {
      const sheet = sheetWith({});
      const formDef = new DocBasedFormToAF().transform(sheet);

      assert.strictEqual(formDef.redirectUrl, undefined);
      assert.strictEqual(formDef.thankYouMsg, undefined);
    });
  });
});
