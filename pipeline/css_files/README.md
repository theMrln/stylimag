# Imaginations Journal Homepage CSS Analysis

Downloaded: January 11, 2026
Source: https://imaginationsjournal.ca

## CSS Files Overview

### 1. **styleSheet.css** (2.7 KB) - MOST IMPORTANT FOR CUSTOM STYLING

Location: `https://imaginationsjournal.ca/public/journals/41/styleSheet.css`

**Purpose**: Custom journal-specific styles that override the base OJS theme

**Key Features**:

- **Fonts**: Karla (body text), Montserrat (headings, navigation)
  - `@import url('https://fonts.googleapis.com/css?family=Karla|Montserrat')`
- **Color Scheme**:
  - Primary accent: `#EE4036` (red/coral) - used for links, buttons, borders
  - Black: `#000000` - text and strong elements
  - White: `#FFFFFF` - backgrounds
- **Navigation**:
  - Uppercase Montserrat font
  - Hover color: `#ef4035`
  - 4px bottom border on active items
- **Buttons**:
  - Primary: Black background, white text (`#000000`/`#ffffff`)
  - Secondary: Red background (`#EE4036`)
  - Font: Montserrat, bold, uppercase
- **Layout**:
  - Logo: Max 200px height, 72% width
  - Labels: Red bottom border (`#EE4036`), 16px Montserrat
  - Mobile responsive: Header resizes at 991px and 767px breakpoints

**Notable Classes**:

```css
.cmp_button_wire,
.obj_galley_link
  -
  Article
  download
  links
  (red background)
  .cmp_manuscript_button
  -
  Submit
  button
  (black background)
  .obj_article_details
  .main_entry
  .label
  -
  Section
  headers
  (red border-bottom)
  .pkp_page_index
  .additional_content
  -
  Homepage
  custom
  content
  area;
```

---

### 2. **main-stylesheet.css** (84 KB)

Location: `https://imaginationsjournal.ca/index.php/imaginations/$$$call$$$/page/page/css?name=stylesheet`

**Purpose**: Base OJS theme stylesheet (minified)

**Key Components**:

- Complete OJS default theme layout system
- Responsive grid: 480px, 768px, 992px, 1200px breakpoints
- Page structure classes: `.pkp_structure_*`
- Article display components: `.obj_article_*`
- Issue display: `.obj_issue_*`
- Navigation: `#navigationPrimary`, `.pkp_navigation_*`
- Forms and user registration
- Search functionality
- Announcements component
- Right-to-left (RTL) language support

**Font Loading**:

- Noto Serif: Regular, Italic, Bold, Bold Italic (local fonts)
- Montserrat: Regular, Bold (local fonts)

---

### 3. **fontawesome.css** (36 KB)

Location: `https://imaginationsjournal.ca/lib/pkp/styles/fontawesome/fontawesome.css`

**Purpose**: Icon fonts (FontAwesome 4.x or 5.x)

**Used For**:

- Navigation icons
- Article type indicators
- Download icons (`.fa-download`)
- Search icon
- Arrow indicators
- File type icons (PDF, etc.)

---

### 4. **cookieconsent.min.css** (3.8 KB)

Location: `https://cdnjs.cloudflare.com/ajax/libs/cookieconsent2/3.0.3/cookieconsent.min.css`

**Purpose**: Cookie consent banner styling (EU GDPR compliance)

---

## Key Layout Structure

### Color Palette

- **Primary Red**: `#EE4036`, `#ef4035` (links, accents, borders)
- **Blue Links**: `#4b7d92`, `#6298ae` (secondary links)
- **Black**: `#000000` (text, strong elements)
- **Grays**: `#ddd` (borders), `rgba(0,0,0,0.54)` (muted text)
- **White**: `#ffffff` (backgrounds)

### Typography Hierarchy

1. **Headings**: Montserrat, bold, uppercase
2. **Body Text**: Karla, 0.98em
3. **Navigation**: Montserrat, 16px, bold, uppercase
4. **Article Details**: Montserrat for labels, 16px

### Responsive Breakpoints

- **Mobile**: < 480px
- **Small tablet**: 480px - 767px
- **Tablet**: 768px - 991px
- **Desktop**: 992px - 1199px
- **Large desktop**: ≥ 1200px

### Key Measurements

- Base line-height: 1.43rem (approximately 20-22px)
- Standard padding: 2.143rem (30px), 1.43rem (20px), 0.714rem (10px)
- Border radius: 3px
- Standard border width: 1px
- Active border width: 4px (navigation)

### Important CSS Classes for Article Templates

**Article Display**:

- `.obj_article_details` - Main article container
- `.obj_article_details .main_entry` - Article content area
- `.obj_article_details .entry_details` - Sidebar metadata
- `.obj_article_details .main_entry .label` - Section headers (red border-bottom)

**Galley Links** (Download buttons):

- `.obj_galley_link` - Standard download link
- `.obj_galley_link.pdf` - PDF-specific styling

**Issue Display**:

- `.obj_issue_toc` - Table of contents
- `.current_issue` - Homepage current issue section

## Usage Notes

1. **Custom overrides** are in `styleSheet.css` - this is where journal-specific styling lives
2. **Base theme** is in `main-stylesheet.css` - provides OJS framework
3. **Icons** require FontAwesome classes (e.g., `.fa-download`, `.fa-search`)
4. **Fonts** use Karla and Montserrat - both loaded from Google Fonts
5. **Responsive design** follows mobile-first approach with min-width media queries

## Recommendations for Article Templates

When creating article HTML templates, use:

1. **Montserrat** for headings and labels (bold, uppercase for emphasis)
2. **Karla** for body text
3. **Red (#EE4036)** for accents and bottom borders on labels
4. **1.43rem** (20-22px) line-height for readability
5. **3px border-radius** for rounded corners
6. Standard OJS classes (`.obj_article_details`, `.main_entry`, etc.) for consistency
