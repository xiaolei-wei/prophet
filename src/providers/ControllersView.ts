import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Command, commands, window, ExtensionContext, workspace, RelativePattern, Uri } from "vscode";
import { findFiles } from "../lib/FileHelper";
import { parse, sep } from 'path';
import { Observable } from "rxjs";



class ControllerItem extends TreeItem {
	constructor(
		public readonly name: string,
		public readonly collapsibleState: TreeItemCollapsibleState,
		public readonly command?: Command,
	) {
		super(name, collapsibleState);

		this.command = {
			title: 'Open',
			command: 'extension.prophet.command.log.open',
			tooltip: 'Open controller',
			arguments: [this]
		};

		// const iconType = [
		// 	'fatal',
		// 	'error',
		// 	'warn',
		// 	'info',
		// 	'debug'
		// ].find(t => name.includes(t)) || 'log';

		this.iconPath = false; //join(__filename, '..', '..', '..', 'images', 'resources', iconType + '.svg');
		//this.contextValue = 'dwLogFile';
	}
}

class ControllerActionItem extends TreeItem {
	files: { name: string, file: Uri, row: number }[] = [];
	constructor(
		public readonly name: string,
		public readonly endpointName: string,
		public readonly collapsibleState: TreeItemCollapsibleState,
		public readonly command?: Command
	) {
		super(endpointName, collapsibleState);


	}
}

class ControllerActionItemFile extends TreeItem {
	constructor(
		public readonly name: string,
		public readonly collapsibleState: TreeItemCollapsibleState,
		public readonly command?: Command
	) {
		super(name, TreeItemCollapsibleState.None);
	}
}

interface ControllerEntry {
	controllerName: string,
	line: number,
	file: Uri,
	entry: string
}

function getCartridgeNameFromPath(str: string) {
	let folders = str.split(sep);
	let res: string | undefined = '';

	while ((res = folders.pop())) {
		if (res === 'cartridge') {
			return folders.pop() || '<never>';
		}
	}

	return res || '<none>';

}


export class ControllersView implements TreeDataProvider<ControllerItem> {
	static initialize(context: ExtensionContext) {

		// // add CartridgesView
		// const cartridgesView = new ControllerItem(
		// 	(window.activeTextEditor) ? window.activeTextEditor.document.fileName : undefined
		// );

		context.subscriptions.push(commands.registerCommand('extension.prophet.command.controllers.find', () => {
			debugger;
			// if (cartridgesView) {
			// 	cartridgesView.refresh(
			// 		((window.activeTextEditor) ? window.activeTextEditor.document.fileName : undefined));
			// }
		}));

		context.subscriptions.push(commands.registerCommand('extension.prophet.command.controllers.refresh', (cartridgeDirectoryItem) => {
			debugger;
			// if (cartridgesView) {
			// 	cartridgesView.createDirectory(cartridgeDirectoryItem);
			// }
		}));

		const controllersView = new ControllersView();
		context.subscriptions.push(
			window.registerTreeDataProvider('dwControllersView', controllersView)
		);
	}
	getTreeItem(element: ControllerItem): TreeItem {
		return element;
	}
	async getChildren(element?: ControllerItem | ControllerActionItem | ControllerActionItemFile): Promise<ControllerItem[] | ControllerActionItem[] | ControllerActionItemFile[]> {

		if (element instanceof ControllerActionItem) {
			return element.files.map(file => new ControllerActionItemFile(
				getCartridgeNameFromPath(file.file.path),
				TreeItemCollapsibleState.None,
				{
					command: 'vscode.open',
					title: 'Open file',
					arguments: [file.file.with({ fragment: String(file.row + 1) })],
				}
			));
		} else if (element instanceof ControllerItem) {

			const filesWorkspaceFolders = (workspace.workspaceFolders || []).filter(workspaceFolder => workspaceFolder.uri.scheme === 'file');

			const endPoints = await Promise.all(filesWorkspaceFolders.map(
				workspaceFolder => findFiles(new RelativePattern(workspaceFolder, `**/cartridge/controllers/${element.name}.js`), +Infinity)
					.flatMap(file => {
						return Observable.fromPromise(workspace.fs.readFile(file))
							.flatMap(fileContent => {
								const fileRows = fileContent.toString().split('\n');
								return new Observable<ControllerEntry>(observer => {
									fileRows.forEach((row, index, content) => {
										if (row.includes('server.')) {
											const entryRegexp = /server\.(get|post|append|replace)\(([\"\'](\w.+?)['\"])/ig;
											const match = entryRegexp.exec(row);

											if (match && match[3]) {
												observer.next({
													controllerName: element.name,
													line: index,
													file: file,
													entry: match[3]
												});
											} else {
												const entryNextLineRegexp = /server\.(get|post|append|replace)\((\s+?)?$/ig;

												if (entryNextLineRegexp.test(row)) {
													const nextRow = content[index + 1];
													const nameOnNextLine = /^(\s+?)?['"](\w+?)['"]/ig;

													const nextRowMatch = nameOnNextLine.exec(nextRow);

													if (nextRowMatch && nextRowMatch[2]) {
														observer.next({
															controllerName: element.name,
															line: index + 1,
															file: file,
															entry: nextRowMatch[2]
														});
													}
												}
											}
										} else if (row.includes('exports.')) {
											const oldControllersCase = /exports.(\w+?) =/ig;

											const match = oldControllersCase.exec(row);

											if (match && match[1]) {
												observer.next({
													controllerName: element.name,
													line: index,
													file: file,
													entry: match[1]
												});
											}

										}
									});
									observer.complete();
								});
							})
					})
					.reduce((acc, item) => { acc.push(item); return acc }, [])
					.toPromise()
			));

			const endpointsMap = new Map<string, ControllerActionItem>();

			endPoints.forEach(endpoints => {
				endpoints.forEach(endpoint => {
					if (!endpointsMap.has(endpoint.entry)) {
						endpointsMap.set(endpoint.entry, new ControllerActionItem(
							endpoint.controllerName,
							endpoint.entry,
							TreeItemCollapsibleState.Collapsed
						))
					}
					const record = endpointsMap.get(endpoint.entry);

					if (record) {
						record.files.push({
							file: endpoint.file,
							name: endpoint.entry,
							row: endpoint.line
						});
					}
				});
			});

			return Array.from(endpointsMap.values()).sort((a, b) => a.endpointName > b.endpointName ? 1 : -1);;
		} else {
			const filesWorkspaceFolders = (workspace.workspaceFolders || []).filter(workspaceFolder => workspaceFolder.uri.scheme === 'file');

			const controllerFiles = await Promise.all(filesWorkspaceFolders.map(
				workspaceFolder => findFiles(new RelativePattern(workspaceFolder, '**/cartridge/controllers/*.js'), +Infinity).reduce((acc, item) => { acc.push(item); return acc }, [])
					.toPromise()
			));

			return controllerFiles.reduce((acc: ControllerItem[], files) => {
				files.forEach(file => {
					const name = parse(file.path).name;
					const exist = acc.find(ctrl => ctrl.name === name);

					if (!exist) {
						acc.push(new ControllerItem(name, TreeItemCollapsibleState.Collapsed));
					}
				});

				return acc;
			}, []).sort((a, b) => a.name > b.name ? 1 : -1);
		}

	}
}
