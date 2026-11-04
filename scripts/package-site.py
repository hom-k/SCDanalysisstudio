"""Build a public-only directory for GitHub Pages and a matching upload ZIP."""
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'dist'
output.mkdir(exist_ok=True)
files = ['index.html', 'reference.html', 'styles.css', 'studio.css', 'sitemap.xml']
files += [path.name for path in root.glob('google*.html')]
for name in files:
    shutil.copy2(root / name, output / name)
for name in ['js', 'assets', 'vendor']:
    shutil.copytree(root / name, output / name, dirs_exist_ok=True)
(output / '.nojekyll').touch()
with ZipFile(root / 'SCD-website-upload.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted(output.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(output))
print(f'Prepared {len(list(output.rglob("*")))} public entries in dist/ and SCD-website-upload.zip')
