# CSS Review and Recommendations for article_template.html5

## Executive Summary
The CSS contains significant redundancy between `@media screen` and `@media print` blocks, duplicate property declarations, empty rules, and opportunities for better use of CSS variables. This document identifies specific issues and provides recommendations.

---

## Critical Issues

### 1. Duplicate Property Declarations

#### Issue: `font-variant` declared twice
**Location:** Print media, lines 583-584
```css
font-variant: prince-opentype(onum);
font-variant: oldstyle-nums;  /* This overwrites the previous line */
```
**Fix:** Combine into one declaration:
```css
font-variant: prince-opentype(onum);
font-variant-numeric: oldstyle-nums;
```

#### Issue: `padding` declared twice
**Location:** Print media, lines 897-898
```css
padding: 0;
padding: 0.3em 0 0 0;  /* This overwrites the previous line */
```
**Fix:** Use only the second declaration:
```css
padding: 0.3em 0 0 0;
```

#### Issue: `font-variant` in `.abstract` and `.author` (print)
**Location:** Lines 712-713
```css
font-variant: prince-opentype(onum);
font-variant: oldstyle-nums;  /* Overwrites previous */
```
**Fix:** Same as above - use `font-variant-numeric` for the second.

---

### 2. Empty CSS Rules

**Location:** Lines 1001, 1003-1004
```css
header#title-block-header {}

h1,
header h1.title {}
```
**Recommendation:** Remove these empty rules entirely.

---

### 3. Duplicate Selector Definitions

#### Issue: `.displayFlexItemRight` defined twice in screen media
**Location:** Lines 376-381 and 384-389
The second definition (384-389) overrides the first. These should be merged:
```css
.displayFlexItemRight {
  padding-left: 1rem;
  padding-right: 0;  /* From second definition */
  margin-left: 1rem;  /* From second definition */
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: auto;
}
```

#### Issue: Same duplication in print media
**Location:** Lines 782-789 and 792-797
Same fix applies.

---

### 4. Redundant Hyphens Declarations

**Location:** Multiple places (e.g., lines 73-75, 589-591)
```css
-webkit-hyphens: auto;
-ms-hyphens: auto;
hyphens: auto;
```
**Note:** While redundant for modern browsers, these vendor prefixes may be needed for PrinceXML compatibility. **Keep as-is** unless testing confirms they're unnecessary.

---

## Simplification Opportunities

### 5. Consolidate Common Properties with CSS Variables

**Current:** Many repeated values like `#e9362c`, `#828383`, `#a3aaa7`, etc.

**Recommendation:** Add more CSS variables in `:root`:
```css
:root {
  --serif-font: "Merriweather", serif;
  --sans-font: "Mulish", sans-serif;
  --primary-color: #e9362c;
  --text-color: #1c1b1a;
  --secondary-text: #828383;
  --caption-color: #a3aaa7;
  --border-color: #ddd;
}
```

### 6. Merge Similar Rules

#### Issue: `tr` and `td` have overlapping styles
**Location:** Screen media, lines 189-201
```css
tr {
  font-size: 0.889rem;
  font-family: var(--sans-font);
}

td {
  font-size: 0.889rem;
  font-family: var(--sans-font);
}
```
**Fix:** Combine selectors:
```css
tr,
td {
  font-size: 0.889rem;
  font-family: var(--sans-font);
}
```

#### Issue: Same in print media
**Location:** Lines 615-619
Already combined, but could be merged with `th, td` above it.

---

### 7. Redundant Selector Combinations

#### Issue: `.figcaption.p` selector
**Location:** Screen media, line 145
```css
figcaption,
figcaption.p {
```
**Note:** `figcaption.p` is redundant - a `figcaption` element cannot have class `p` in standard HTML. However, this may be a Pandoc-generated class. **Verify usage before removing.**

---

### 8. Duplicate Figure/Figcaption Rules

**Location:** Print media, lines 502-517 and 846-861
The `.figcaption p` rule (846-861) duplicates most of the `figcaption` rule (502-517). Consider consolidating or using a more specific selector.

---

### 9. Unused or Questionable Rules

#### Issue: `.flex-items` class
**Location:** Line 408-410 (screen), not present in print
```css
.flex-items {
  flex-shrink: 3;
}
```
**Recommendation:** Verify if this class is used in the HTML. If not, remove it.

#### Issue: `.type` class
**Location:** Print media, lines 691-695
Only defined in print, not in screen. Verify usage.

---

## Structural Improvements

### 10. Organize CSS by Feature, Not Media Type

**Current Structure:**
- All screen styles together
- All print styles together
- Much duplication between them

**Alternative Approach:** Use shared base styles with media-specific overrides:
```css
/* Base styles (shared) */
p, li { /* common properties */ }

@media screen {
  /* screen-specific overrides */
}

@media print {
  /* print-specific overrides */
}
```

**Note:** This is a larger refactoring. Consider if the current structure is easier to maintain for your workflow.

---

### 11. Consolidate Flexbox Rules

The flexbox-related classes have significant duplication:
- `.displayFlexbox` (screen: 362-367, print: 775-780)
- `.displayFlexItemLeft` (screen: 369-374, print: 782-789)
- `.displayFlexItemRight` (duplicated in both)
- `.displayFlexItemLeftAlt` (screen: 392-395, print: 799-802)
- `.displayFlexItemRightAlt` (screen: 397-400, print: 804-807)
- `.flexContainer` (screen: 402-406, print: 809-813)

**Recommendation:** Consider if all these variations are needed, or if they can be consolidated.

---

## PrinceXML-Specific Notes

### Properties to Keep (Non-Standard but Required)
- `prince-opentype()` in `font-variant`
- `string-set` properties
- `prince-page-fill`, `prince-pdf-*` properties
- `break-before`, `break-inside` (CSS Fragmentation)
- `prince-snap` for figures
- `@prince-pdf` and `@page` rules
- `@footnotes` rules

### Properties That May Be Redundant
- `-epub-hyphens` (PrinceXML may not need this)
- `-webkit-column-span` (PrinceXML uses `column-span`)
- Multiple `page-break-*` and `break-*` properties (test if both are needed)

---

## Priority Recommendations

### High Priority (Fix Immediately)
1. ✅ Remove duplicate `font-variant` declarations (lines 583-584, 712-713)
2. ✅ Remove duplicate `padding` declaration (lines 897-898)
3. ✅ Remove empty CSS rules (lines 1001, 1003-1004)
4. ✅ Merge duplicate `.displayFlexItemRight` definitions

### Medium Priority (Improve Maintainability)
5. Add more CSS variables for colors and common values
6. Consolidate `tr` and `td` selectors where appropriate
7. Verify and remove unused classes (`.flex-items`, `.type`)

### Low Priority (Consider for Future Refactoring)
8. Consider restructuring to reduce duplication between screen/print
9. Consolidate flexbox class variations if possible
10. Test if vendor prefixes are still needed for PrinceXML

---

## Testing Recommendations

Before making changes:
1. Test PDF generation with PrinceXML after each change
2. Verify screen rendering in browsers
3. Check that all article variations still render correctly
4. Ensure page breaks and typography remain correct

---

## Summary Statistics

- **Total CSS Lines:** ~1015 lines
- **Estimated Duplication:** ~40-50% between screen and print
- **Empty Rules:** 2
- **Duplicate Property Declarations:** 3+ instances
- **Duplicate Selector Definitions:** 2+ instances
- **Potential for CSS Variables:** High (colors, fonts, spacing)

