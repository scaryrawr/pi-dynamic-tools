import type { Api, Model } from "@earendil-works/pi-ai";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Focusable,
  fuzzyFilter,
  Input,
  Key,
  type KeybindingsManager,
  matchesKey,
  Spacer,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

/** Searchable picker based on pi-automode's model selector. */
export class SemanticModelSelector extends Container implements Focusable {
  private readonly searchInput = new Input({ placeholder: "Filter models by provider or name..." });
  private readonly list = new Container();
  private readonly title = new Text("", 1, 0);
  private readonly hint = new Text("", 1, 0);
  private readonly help = new Text("", 1, 0);
  private readonly models: Model<Api>[];
  private filtered: Model<Api>[];
  private index = 0;
  private _focused = false;

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    models: Model<Api>[],
    private readonly current: string | undefined,
    private readonly onSelect: (modelId: string) => void,
    private readonly onCancel: () => void,
  ) {
    super();
    this.models = [...models].sort((a, b) => {
      const aCurrent = `${a.provider}/${a.id}` === current;
      const bCurrent = `${b.provider}/${b.id}` === current;
      return Number(bCurrent) - Number(aCurrent) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
    });
    this.filtered = this.models;
    this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    this.addChild(new Spacer(1));
    this.addChild(this.title);
    this.addChild(this.hint);
    this.addChild(new Spacer(1));
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.help);
    this.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    this.rebuild();
  }

  private rebuild(): void {
    this.title.setText(this.theme.fg("accent", this.theme.bold("Select Semantic Search Model")));
    this.hint.setText(this.theme.fg("muted", "Configured models only. Use /login to add providers."));
    this.help.setText(this.theme.fg("dim", "Type to filter · ↑↓ navigate · Enter select · Esc cancel"));
    this.list.clear();
    const maxVisible = 10;
    const start = Math.max(0, Math.min(this.index - Math.floor(maxVisible / 2), this.filtered.length - maxVisible));
    for (const model of this.filtered.slice(start, start + maxVisible)) {
      const selected = model === this.filtered[this.index];
      const active = `${model.provider}/${model.id}` === this.current;
      const label = `${model.id} [${model.provider}]${active ? " ✓" : ""}`;
      this.list.addChild(new Text(
        selected ? this.theme.fg("accent", `→ ${label}`) : `  ${label}`,
        1,
        0,
      ));
    }
    if (this.filtered.length === 0) {
      this.list.addChild(new Text(this.theme.fg("muted", "No matching models"), 1, 0));
    } else {
      if (this.filtered.length > maxVisible) {
        this.list.addChild(new Text(this.theme.fg("dim", `  ${this.index + 1}/${this.filtered.length}`), 1, 0));
      }
      const selected = this.filtered[this.index];
      if (selected) this.list.addChild(new Text(this.theme.fg("muted", `  ${selected.name}`), 1, 0));
    }
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.index = (this.index + this.filtered.length - 1) % (this.filtered.length || 1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.index = (this.index + 1) % (this.filtered.length || 1);
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      const model = this.filtered[this.index];
      if (model) this.onSelect(`${model.provider}/${model.id}`);
      return;
    } else {
      const before = this.searchInput.getValue();
      this.searchInput.handleInput(data);
      const after = this.searchInput.getValue();
      if (before !== after) {
        this.filtered = after
          ? fuzzyFilter(this.models, after, (model) => `${model.provider}/${model.id} ${model.name}`)
          : this.models;
        this.index = 0;
      }
    }
    this.rebuild();
    this.tui.requestRender();
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }
}
