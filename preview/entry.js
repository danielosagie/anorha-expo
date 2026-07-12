// Dev-only preview entry. Activate by temporarily pointing package.json "main"
// here (see preview/README.md); the shipped app entry is untouched.
import { registerRootComponent } from 'expo';
import PreviewApp from './PreviewApp';

registerRootComponent(PreviewApp);
