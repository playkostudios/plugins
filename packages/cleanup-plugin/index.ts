import {EditorPlugin, project, ui, data, Access} from '@wonderlandengine/editor-api';
import {existsSync} from 'node:fs';

const EPSILON = 1e-6;
const VEC3_ZERO = [0, 0, 0] as const;
const VEC3_ONE = [1, 1, 1] as const;
const QUAT_IDENTITY = [0, 0, 0, 1] as const;

/**
 * Plugin to cleanup resources with broken links.
 */
export default class CleanupPlugin extends EditorPlugin {
    result: Record<string, string[]> = {};

    /* The constructor is called when your plugin is loaded */
    constructor() {
        super();
        this.name = 'Project Cleanup Plugin';
    }

    /* Use this function for drawing UI */
    draw() {
        ui.text('Unused Resources');
        ui.separator();

        if (Object.keys(this.result).length == 0) {
            this.collectResources();
            return;
        }

        for (let k of Object.keys(this.result)) {
            ui.text(`Found ${this.result[k].length.toString()} unused ${k}`);
        }

        ui.separator();
        if (ui.button('Refresh')) {
            this.collectResources();
        }
        ui.sameLine();
        if (ui.button('Delete all')) {
            this.cleanup();
        }
    }

    LINK_CACHE: Record<string, boolean> = {};

    /* Check whether the file linked by a resource exists, caching the result */
    linkExists(path: string) {
        if (!(path in this.LINK_CACHE)) {
            /* Try as relative to project root first then unprefixed in case it's an absolute path */
            this.LINK_CACHE[path] = existsSync(project.root + '/' + path) || existsSync(path);
        }
        return this.LINK_CACHE[path];
    }

    /* Collect all resources whose linked file is missing */
    collectResources() {
        /* Clear previous results and link cache */
        this.result = {};
        this.LINK_CACHE = {};

        for (let res of [
            'meshes',
            'textures',
            'materials',
            'images',
            'animations',
            'skins',
        ]) {
            const list = [];
            for (const k of Object.keys(data[res])) {
                const file = data[res][k].link?.file;
                if (file && file !== 'default' && !this.linkExists(file)) {
                    list.push(k);
                }
            }

            this.result[res] = list;
        }
    }

    cleanup() {
        for (let r of Object.keys(this.result)) {
            for (let k of this.result[r]) {
                delete data[r][k];
            }
            console.log('Deleted', this.result[r].length, r);
        }

        this.collectResources();
    }

    private equalsEps(a: number, b: number) {
        return Math.abs(a - b) < EPSILON;
    }

    private roundNumber(val: number) {
        if (this.equalsEps(val, 0)) return 0;

        const wantsNegative = val < 0;
        const positiveVal = Math.abs(val);
        const nearestPower = 2 ** Math.round(Math.log2(positiveVal));

        if (this.equalsEps(positiveVal, nearestPower)) {
            return wantsNegative ? -nearestPower : nearestPower;
        } else {
            return val;
        }
    }

    private simplifyVector(access: Access, key: string, defaultVal: ReadonlyArray<number>, allowDelete: boolean) {
        if (!access.exists(key)) return;

        let isDefault = true;
        let changed = false;
        const val = [...access[key]];
        for (let i = defaultVal.length - 1; i >= 0; i--) {
            const newVal = this.roundNumber(val[i]);
            if (newVal !== val[i]) {
                val[i] = newVal;
                changed = true;
            }

            if (!this.equalsEps(defaultVal[i], val[i])) isDefault = false;
        }

        if (allowDelete && isDefault) {
            delete access[key];
        } else if (changed) {
            access[key] = val;
        }
    }

    private simplifyFlag(access: Access, key: string, defaultVal: boolean) {
        if (access.exists(key) && access[key] === defaultVal) delete access[key];
    }

    preProjectSave(): boolean {
        for (const object of Object.values(data.objects)) {
            const isLinked = object.link !== null;

            // linked objects have different defaults, so they shouldn't be
            // deleted, only rounded
            this.simplifyVector(object, 'translation', VEC3_ZERO, !isLinked);
            this.simplifyVector(object, 'scaling', VEC3_ONE, !isLinked);
            this.simplifyVector(object, 'rotation', QUAT_IDENTITY, !isLinked);

            if (!object.exists('components')) continue;

            for (let c = object.components.length; c >= 0; c--) {
                const component = object.components[c];
                if (!component) {
                    if (!isLinked) object.components.splice(c, 1);
                    continue;
                }

                this.simplifyFlag(component, 'active', true);
                if (isLinked) continue;

                // TODO simplify component properties in object when component
                //      class metadata is available in the editor api
                // TODO remove invalid components
            }

            if (!isLinked && object.components.length === 0) {
                delete object.components;
                continue;
            }
        }
        return true;
    }
}
