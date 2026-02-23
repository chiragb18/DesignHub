import { Component, inject, effect, computed, ChangeDetectionStrategy } from '@angular/core';
import * as fabric from 'fabric';
import { BannerService } from '../services/banner.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { DragDropModule, CdkDragDrop } from '@angular/cdk/drag-drop';

import { TemplatesPanel } from '../templates-panel/templates-panel';

@Component({
    selector: 'app-right-sidebar',
    standalone: true,
    imports: [CommonModule, FormsModule, MatIconModule, MatDividerModule, MatButtonModule, TemplatesPanel, DragDropModule],
    templateUrl: './right-sidebar.html',
    styleUrl: './right-sidebar.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RightSidebarComponent {
    public bannerService = inject(BannerService);

    // State for UI
    selectedFont: string = 'Inter';
    fontSize: number = 32;
    textColor: string = '#1a1a1a';
    fillColor: string = '#ffffff';
    opacity: number = 100;
    textAlign: string = 'left';
    charSpacing: number = 0;
    lineHeight: number = 1.2;
    angle: number = 0;

    // Advanced adjustments
    brightness: number = 0;
    contrast: number = 0;
    saturation: number = 0;

    // Mask State
    maskType: string = 'none';
    maskHeight: number = 20;
    maskFlip: boolean = false;

    bgSolidColor: string = '#ffffff';
    bgGradColor1: string = '#fe8dc6';
    bgGradColor2: string = '#fed1c7';

    fontFamilies = [
        { name: 'Inter (Inter)', value: 'Inter' },
        { name: 'Poppins (Poppins)', value: 'Poppins' },
        { name: 'Outfit (Outfit)', value: 'Outfit' },
        { name: 'Roboto (Roboto)', value: 'Roboto' },
        { name: 'Montserrat (Montserrat)', value: 'Montserrat' },
        { name: 'Lato (Lato)', value: 'Lato' },
        { name: 'Open Sans (Open Sans)', value: 'Open Sans' },
        { name: 'Raleway (Raleway)', value: 'Raleway' },
        { name: 'Playfair Display (Playfair Display)', value: 'Playfair Display' },
        { name: 'Nunito (Nunito)', value: 'Nunito' },
        { name: 'Oswald (Oswald)', value: 'Oswald' },
        { name: 'Hind (Hind)', value: 'Hind' },
        { name: 'Teko (Teko)', value: 'Teko' },
        { name: 'Pacifico (Pacifico)', value: 'Pacifico' },
        { name: 'Dancing Script (Dancing Script)', value: 'Dancing Script' },
        { name: 'Lobster (Lobster)', value: 'Lobster' },
        { name: 'Caveat (Caveat)', value: 'Caveat' },
        { name: 'Satisfy (Satisfy)', value: 'Satisfy' },
        { name: 'Kaushan Script (Kaushan Script)', value: 'Kaushan Script' },
        { name: 'Great Vibes (Great Vibes)', value: 'Great Vibes' },
        { name: 'Sacramento (Sacramento)', value: 'Sacramento' },
        { name: 'Mr Dafoe (Mr Dafoe)', value: 'Mr Dafoe' },
        { name: 'Pinyon Script (Pinyon Script)', value: 'Pinyon Script' },
        { name: 'Rochester (Rochester)', value: 'Rochester' },
        { name: 'Grand Hotel (Grand Hotel)', value: 'Grand Hotel' },
        { name: 'Homemade Apple (Homemade Apple)', value: 'Homemade Apple' },
        { name: 'Yesteryear (Yesteryear)', value: 'Yesteryear' },
        { name: 'Petit Formal Script (Petit Formal Script)', value: 'Petit Formal Script' },
        { name: 'Righteous (Righteous)', value: 'Righteous' },
        { name: 'Anton (Anton)', value: 'Anton' },
        { name: 'Bangers (Bangers)', value: 'Bangers' },
        { name: 'Permanent Marker (Permanent Marker)', value: 'Permanent Marker' },
        { name: 'Fredoka One (Fredoka One)', value: 'Fredoka One' },
        { name: 'Noto Sans Devanagari', value: 'Noto Sans Devanagari' },
        { name: 'Shrikhand (Shrikhand)', value: 'Shrikhand' }
    ];

    selectedObject = this.bannerService.selectedObject;
    canvasObjects = this.bannerService.objects;

    // Computed reversed layers for UI (Top layer at top of list)
    reversedLayers = computed(() => {
        return [...this.canvasObjects()].reverse();
    });

    blurAmount = 0;

    emojiCategories = [
        {
            name: 'Smileys & People',
            emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '🥹', '☺️', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🫣', '🤭', '🫡', '🤫', '🫠', '🤥', '😶', '🫥', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾']
        },
        {
            name: 'Gestures & Body',
            emojis: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '🫵', '🫱', '🫲', '🫸', '🫷', '🫳', '🫴', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🫶', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👣', '👀', '👁', '👅', '👄', '💋', '🩸']
        },
        {
            name: 'Nature & Animals',
            emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕🦺', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀', '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🍄', '🐚', '🪨', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖']
        },
        {
            name: 'Food & Drink',
            emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', 'バター', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽', '🥣', '🥡', '🥢', '🧂']
        },
        {
            name: 'Objects & Symbols',
            emojis: ['⌚️', '📱', '💻', '⌨️', '🖥', '🖨', 'マウス', '🕹', '💾', '💿', '📀', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', 'テレビ', 'ラジオ', '🎙', '⏱', '⏲', 'アラーム', '🕰', '⌛️', '⏳', '電池', 'プラグ', '💡', '🔦', 'キャンドル', '🧯', '💸', '💵', '💴', '💶', '💷', 'コイン', '袋', 'カード', '💎', '⚖️', '梯子', '工具', 'ドライバー', 'レンチ', '金槌', '⚒', '🛠', 'つるはし', '鋸', 'ボルト', 'ギア', '罠', '煉瓦', '鎖', '磁石', '銃', '爆弾', '花火', '斧', 'ナイフ', '短剣', '剣', '盾', '煙草', '棺', '🪦', '骨壷', '🏺', '水晶', '数珠', 'お守り', 'ポール', 'フラスコ', '望遠鏡', '顕微鏡', '包帯', '聴診器', '薬', '注射器', '血液', 'DNA', 'ウイルス', '試験管', '温度計', '箒', '🪠', '籠', 'トイレットペーパー', '便器', 'シャワー', '浴槽', '入浴', '石鹸', '歯ブラシ', 'カミソリ', 'スポンジ', 'バケツ', '呼び鈴', '鍵', '古鍵', '扉', '椅子', 'ソファ', 'ベッド', '睡眠', 'ぬいぐるみ', '額縁', '鏡', '買い物袋', 'カート', '贈り物', '風船', '鯉のぼり', 'リボン', '杖', '紙吹雪', 'クラッカー', '雛人形', '提灯', '風鈴', 'ポチ袋', '封筒', '📩', '📨', '📧', '💌', '📥', '📤', '小包', 'タグ', 'ポスト', '📮', '📯', '巻物', '📃', '📄', '📑', 'レシート', '統計', '上昇', '下降', 'メモ', 'カレンダー', '🗑', 'カード入れ', '箱', 'ファイル', '書類入れ', 'クリップボード', '📁', '📂', '名刺入れ', '新聞', '📓', '📔', '帳面', '📕', '📗', '📘', '📙', '本棚', '開いた本', '栞', '安全ピン', 'リンク', 'クリップ', '🖇', '三角定規', '直定規', '算盤', '押しピン', '画鋲', 'ハサミ', 'ペン', '万年筆', '筆', 'ブラシ', 'クレヨン', 'メモ帳', '鉛筆', '虫眼鏡', '🔍', '鍵付きペン', '秘密', '錠', '開いた錠', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔']
        }
    ];

    constructor() {
        effect(() => {
            const obj = this.selectedObject() as any;
            if (obj) {
                this.opacity = Math.round((obj.opacity || 1) * 100);
                this.angle = Math.round(obj.angle || 0);

                // Sync blur amount
                if (obj.type === 'image') {
                    const blurFilter = obj.filters?.find((f: any) => f.type === 'Blur');
                    this.blurAmount = blurFilter ? Math.round(blurFilter.blur * 10) : 0;
                } else {
                    this.blurAmount = obj.shadow ? Math.round(obj.shadow.blur / 2) : 0;
                }

                if (obj.type === 'textbox' || obj.type === 'i-text') {
                    this.selectedFont = obj.fontFamily || 'Inter';
                    this.fontSize = Math.round(obj.fontSize || 32);
                    const fill = typeof obj.fill === 'string' ? obj.fill : '#1a1a1a';
                    this.textColor = fill.startsWith('#') ? fill : '#1a1a1a';
                    this.textAlign = obj.textAlign || 'left';
                    this.charSpacing = (obj.charSpacing || 0) / 10;
                    this.lineHeight = obj.lineHeight || 1.16;
                } else {
                    const fill = typeof obj.fill === 'string' ? obj.fill : '#ffffff';
                    this.fillColor = fill.startsWith('#') ? fill : '#ffffff';
                }

                if (obj.type === 'image') {
                    const img = obj as fabric.Image;
                    const filters = img.filters || [];

                    // Manual Adjustments Sync (-1..1 to -100..100)
                    const b = filters.find((f: any) => f.type === 'Brightness') as any;
                    this.brightness = b ? Math.round(b.brightness * 100) : 0;

                    const c = filters.find((f: any) => f.type === 'Contrast') as any;
                    this.contrast = c ? Math.round(c.contrast * 100) : 0;

                    const s = filters.find((f: any) => f.type === 'Saturation') as any;
                    this.saturation = s ? Math.round(s.saturation * 100) : 0;
                }

                // Sync Mask
                this.maskType = (obj as any).maskType || 'none';
                this.maskHeight = (obj as any).maskHeight || 20;
                this.maskFlip = (obj as any).maskFlip || false;
            }
        });

        // Effect to update layer previews
        effect(() => {
            const objs = this.canvasObjects();
            objs.forEach(obj => {
                if (obj.type === 'image') {
                    const img = obj as any;
                    const src = img.src || img._element?.src || (img.getSrc ? img.getSrc() : null);
                    if (src && !src.startsWith('indexeddb://')) {
                        img._layerPreview = src;
                    }
                } else if (!(obj as any)._layerPreview || (obj as any).dirty) {
                    try {
                        (obj as any)._layerPreview = obj.toDataURL({
                            format: 'png',
                            multiplier: 120 / (obj.width || 100),
                            quality: 0.2
                        });
                    } catch (e) { }
                }
            });
        });
    }

    get currentObject(): any {
        return this.selectedObject() || this.bannerService.penCutTarget;
    }

    // Mask Methods
    applyMask(type: string) {
        this.maskType = type;
        this.bannerService.applyImageMask(type as any, this.maskHeight, this.maskFlip);
    }

    updateMaskHeight(val: any) {
        this.maskHeight = Number(val);
        this.bannerService.applyImageMask(this.maskType as any, this.maskHeight, this.maskFlip);
    }

    toggleMaskFlip() {
        this.maskFlip = !this.maskFlip;
        this.bannerService.applyImageMask(this.maskType as any, this.maskHeight, this.maskFlip);
    }

    onPropertyChange(prop: string, value: any) {
        if (prop === 'charSpacing') {
            this.bannerService.updateProperty(prop, value * 10);
        } else {
            this.bannerService.updateProperty(prop, value);
        }
    }

    addShape(type: any) {
        this.bannerService.addShape(type);
    }

    toggleStyle(style: string) {
        const obj = this.currentObject;
        if (!obj) return;
        if (style === 'bold') {
            const current = obj.fontWeight === 'bold' ? 'normal' : 'bold';
            this.onPropertyChange('fontWeight', current);
        } else if (style === 'italic') {
            const current = obj.fontStyle === 'italic' ? 'normal' : 'italic';
            this.onPropertyChange('fontStyle', current);
        } else if (style === 'underline') {
            this.onPropertyChange('underline', !obj.underline);
        }
    }

    alignText(pos: any) {
        this.onPropertyChange('textAlign', pos);
    }

    alignCanvas(pos: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
        this.bannerService.alignObject(pos);
    }

    selectLayer(obj: any) {
        this.bannerService.setActiveObject(obj);
    }

    deleteLayer(obj: any) {
        this.bannerService.deleteObject(obj);
    }

    toggleVisibility(obj: any) {
        this.bannerService.toggleVisibility(obj);
    }

    toggleLock(obj: any) {
        this.bannerService.toggleLock(obj);
    }

    onLayerHover(obj: any) {
        this.bannerService.setHoveredObject(obj);
    }

    onLayerHoverOut() {
        this.bannerService.setHoveredObject(null);
    }

    moveLayer(obj: any, direction: 'up' | 'down' | 'top' | 'bottom') {
        this.bannerService.moveLayer(obj, direction);
    }

    drop(event: CdkDragDrop<string[]>) {
        if (event.previousIndex === event.currentIndex) return;
        const count = this.canvasObjects().length;
        const fromFabric = count - 1 - event.previousIndex;
        const toFabric = count - 1 - event.currentIndex;
        this.bannerService.reorderLayers(fromFabric, toFabric);
    }

    getLayerIcon(type: string): string {
        switch (type) {
            case 'textbox': return 'title';
            case 'image': return 'image';
            case 'rect': return 'rectangle';
            case 'circle': return 'circle';
            case 'triangle': return 'change_history';
            case 'polygon': return 'pentagon';
            default: return 'layers';
        }
    }

    getLayerPreview(obj: any): string | null {
        return obj._layerPreview || null;
    }

    getLayerName(obj: any): string {
        if (obj.type === 'textbox' || obj.type === 'i-text') {
            const text = obj.text || '';
            return text.length > 20 ? text.substring(0, 17) + '...' : text || 'Empty Text';
        }
        if (obj.name) return obj.name;
        if (obj.type === 'rect') return 'Rectangle';
        if (obj.type === 'circle') return 'Circle';
        if (obj.type === 'triangle') return 'Triangle';
        if (obj.type === 'path') return 'Vector Path';
        return obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
    }

    crop() {
        this.bannerService.cropSelection();
    }

    flip(dir: 'h' | 'v') {
        this.bannerService.flip(dir);
    }

    applyEffect(type: 'outline' | 'gradient' | 'shadow') {
        this.bannerService.applyTextEffect(type);
    }

    setSolidBg(color: string) {
        this.bgSolidColor = color;
        this.bannerService.setCanvasBg(color);
    }

    setGradientBg() {
        this.bannerService.setGradientBg(this.bgGradColor1, this.bgGradColor2);
    }

    setPatternBg(color: string) {
        this.bannerService.setPatternBg(color);
    }

    updateBrightness(val: any) {
        this.brightness = +val;
        this.bannerService.setBrightness(this.brightness / 100);
    }

    updateContrast(val: any) {
        this.contrast = +val;
        this.bannerService.setContrast(this.contrast / 100);
    }

    updateSaturation(val: any) {
        this.saturation = +val;
        this.bannerService.setSaturation(this.saturation / 100);
    }

    onGravityFileSelected(event: any) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e: any) => {
                this.bannerService.setAntiGravityBg(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    }

    addText(type: 'heading' | 'subheading' | 'body') {
        const styles = {
            heading: { fontSize: 48, fontWeight: 'bold' },
            subheading: { fontSize: 32, fontWeight: 'medium' },
            body: { fontSize: 18, fontWeight: 'normal' }
        };
        const s = (styles as any)[type];
        this.bannerService.addText(type.charAt(0).toUpperCase() + type.slice(1), s);
    }

    getObjectTypeName(type: string): string {
        const typeMap: { [key: string]: string } = {
            'textbox': 'TEXTBOX',
            'i-text': 'TEXTBOX',
            'image': 'IMAGE',
            'rect': 'SHAPE',
            'circle': 'SHAPE',
            'triangle': 'SHAPE',
            'polygon': 'SHAPE',
            'path': 'SHAPE',
            'group': 'GROUP'
        };
        return typeMap[type] || type.toUpperCase();
    }

    addSticker(emoji: string) {
        this.bannerService.insertEmoji(emoji);
    }

    applyBlur(value: number) {
        this.bannerService.setBlur(value);
    }

    // Drawing Methods
    selectBrush(type: string) {
        this.bannerService.setBrushType(type);
        if (!this.bannerService.isDrawingMode()) {
            this.bannerService.toggleDrawingMode(true);
        }
    }

    utilUpdateBrushSize(event: Event) {
        const size = parseInt((event.target as HTMLInputElement).value);
        this.bannerService.updateBrushSize(size);
    }

    utilUpdateBrushOpacity(event: Event) {
        const opacity = parseFloat((event.target as HTMLInputElement).value);
        this.bannerService.brushOpacity.set(opacity);
        this.bannerService.setBrushType(this.bannerService.brushType());
    }

    utilUpdateBrushColor(event: any) {
        this.bannerService.updateBrushColor(event.target.value);
    }

    utilUpdateBrushSmoothing(event: Event) {
        const smoothing = parseInt((event.target as HTMLInputElement).value);
        this.bannerService.brushSmoothing.set(smoothing);
        this.bannerService.setBrushType(this.bannerService.brushType());
    }
}
