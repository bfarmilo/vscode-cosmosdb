/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureActionHandler, IAzureParentNode, AzureTreeDataProvider, IAzureNode, IActionContext, callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import * as vscode from 'vscode';
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import MongoDBLanguageClient from "./languageClient";
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoCommands } from "./MongoCommands";
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";
import { MongoCollectionNodeEditor } from "./editors/MongoCollectionNodeEditor";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { ext } from "../extensionVariables";
import { reporter } from "../utils/telemetry";

const connectedDBKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';

export function registerMongoCommands(context: vscode.ExtensionContext, actionHandler: AzureActionHandler, tree: AzureTreeDataProvider, editorManager: CosmosEditorManager): void {
    let languageClient: MongoDBLanguageClient = new MongoDBLanguageClient(context);

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(context, tree, languageClient);

    actionHandler.registerCommand('cosmosDB.createMongoDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoAccountTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode);
    });
    actionHandler.registerCommand('cosmosDB.createMongoCollection', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode.parent);
    });
    actionHandler.registerCommand('cosmosDB.createMongoDocument', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await node.createChild();
    });
    actionHandler.registerCommand('cosmosDB.connectMongoDB', async (node?: IAzureParentNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.id;
        await languageClient.connect(node.treeItem.connectionString, node.treeItem.databaseName);
        context.globalState.update(connectedDBKey, node.id);
        ext.connectedMongoDB = node;
        await node.refresh();

        if (oldNodeId) {
            // We have to use findNode to get the instance of the old node that's being displayed in the tree. Our specific instance might have been out-of-date
            const oldNode: IAzureNode | undefined = await tree.findNode(oldNodeId);
            if (oldNode) {
                await oldNode.refresh();
            }
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDB', async (node?: IAzureNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
        if (ext.connectedMongoDB && ext.connectedMongoDB.id === node.id) {
            ext.connectedMongoDB = undefined;
            context.globalState.update(connectedDBKey, undefined);
            languageClient.disconnect();
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoCollection', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDocument', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoDocumentTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.openCollection', async (node?: IAzureParentNode<MongoCollectionTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoCollectionTreeItem>>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await editorManager.showDocument(new MongoCollectionNodeEditor(node), 'cosmos-collection.json');
    });
    actionHandler.registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    actionHandler.registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
    actionHandler.registerCommand('cosmosDB.executeMongoCommand', async function (this: IActionContext) {
        await loadPersistedMongoDBTask;
        await MongoCommands.executeCommandFromActiveEditor(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this);
    });
    actionHandler.registerCommand('cosmosDB.executeAllMongoCommands', async function (this: IActionContext) {
        await loadPersistedMongoDBTask;
        await MongoCommands.executeAllCommandsFromActiveEditor(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this);
    });
}

async function loadPersistedMongoDB(context: vscode.ExtensionContext, tree: AzureTreeDataProvider, languageClient: MongoDBLanguageClient): Promise<void> {
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', reporter, undefined, async function (this: IActionContext): Promise<void> {
        this.suppressErrorDisplay = true;
        this.properties.isActivationEvent = 'true';
        const persistedNodeId: string | undefined = context.globalState.get(connectedDBKey);
        if (persistedNodeId) {
            const persistedNode: IAzureNode | undefined = await tree.findNode(persistedNodeId);
            if (persistedNode) {
                await languageClient.client.onReady();
                await vscode.commands.executeCommand('cosmosDB.connectMongoDB', persistedNode);
            }
        }
    });
}

function launchMongoShell() {
    const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
    terminal.sendText(`mongo`);
    terminal.show();
}
