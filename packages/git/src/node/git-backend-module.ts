/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as cluster from 'cluster';
import { ContainerModule, Container, interfaces } from 'inversify';
import { Git, GitPath } from '../common/git';
import { GitWatcherPath, GitWatcherClient, GitWatcherServer } from '../common/git-watcher';
import { DugiteGit, OutputParser, NameStatusParser, CommitDetailsParser, GitBlameParser } from './dugite-git';
import { DugiteGitWatcherServer } from './dugite-git-watcher';
import { ConnectionHandler, JsonRpcConnectionHandler, ILogger } from '@theia/core/lib/common';
import { GitRepositoryManager } from './git-repository-manager';
import { GitRepositoryWatcherFactory, GitRepositoryWatcherOptions, GitRepositoryWatcher } from './git-repository-watcher';
import { GitLocator } from './git-locator/git-locator-protocol';
import { GitLocatorClient } from './git-locator/git-locator-client';
import { GitLocatorImpl } from './git-locator/git-locator-impl';
import { GitExecProvider } from './git-exec-provider';
import { GitPromptServer, GitPromptClient, GitPrompt } from '../common/git-prompt';
import { DugiteGitPromptServer } from './dugite-git-prompt';

export interface GitBindingOptions {
    readonly bindManager: (binding: interfaces.BindingToSyntax<{}>) => interfaces.BindingWhenOnSyntax<{}>;
}

export namespace GitBindingOptions {
    export const Default: GitBindingOptions = {
        bindManager(binding: interfaces.BindingToSyntax<{}>): interfaces.BindingWhenOnSyntax<{}> {
            return binding.to(GitRepositoryManager).inSingletonScope();
        }
    };
}

export function bindGit(bind: interfaces.Bind, bindingOptions: GitBindingOptions = GitBindingOptions.Default): void {
    bindingOptions.bindManager(bind(GitRepositoryManager));
    bind(GitRepositoryWatcherFactory).toFactory(ctx => (options: GitRepositoryWatcherOptions) => {
        const child = new Container({ defaultScope: 'Singleton' });
        child.parent = ctx.container;
        child.bind(GitRepositoryWatcher).toSelf();
        child.bind(GitRepositoryWatcherOptions).toConstantValue(options);
        return child.get(GitRepositoryWatcher);
    });
    if (cluster.isMaster) {
        bind(GitLocator).toDynamicValue(ctx => {
            const logger = ctx.container.get<ILogger>(ILogger);
            return new GitLocatorImpl({
                info: (message, ...args) => logger.info(message, ...args),
                error: (message, ...args) => logger.error(message, ...args)
            });
        });
    } else {
        bind(GitLocator).to(GitLocatorClient);
    }
    bind(DugiteGit).toSelf().inSingletonScope();
    bind(OutputParser).toSelf().inSingletonScope();
    bind(NameStatusParser).toSelf().inSingletonScope();
    bind(CommitDetailsParser).toSelf().inSingletonScope();
    bind(GitBlameParser).toSelf().inSingletonScope();
    bind(GitExecProvider).toSelf().inSingletonScope();
    bind(Git).toService(DugiteGit);
}

export function bindRepositoryWatcher(bind: interfaces.Bind): void {
    bind(DugiteGitWatcherServer).toSelf();
    bind(GitWatcherServer).toDynamicValue(context => context.container.get(DugiteGitWatcherServer));
}

export function bindPrompt(bind: interfaces.Bind): void {
    bind(DugiteGitPromptServer).toSelf().inSingletonScope(); // TODO is this really singleton, probably not.
    bind(GitPromptServer).toDynamicValue(context => context.container.get(DugiteGitPromptServer));
}

export default new ContainerModule(bind => {
    bindGit(bind);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler(GitPath, client => {
            const server = context.container.get<Git>(Git);
            client.onDidCloseConnection(() => server.dispose());
            return server;
        })
    ).inSingletonScope();

    bindRepositoryWatcher(bind);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<GitWatcherClient>(GitWatcherPath, client => {
            const server = context.container.get<GitWatcherServer>(GitWatcherServer);
            server.setClient(client);
            client.onDidCloseConnection(() => server.dispose());
            return server;
        })
    ).inSingletonScope();

    bindPrompt(bind);
    bind(ConnectionHandler).toDynamicValue(context =>
        new JsonRpcConnectionHandler<GitPromptClient>(GitPrompt.WS_PATH, client => {
            const server = context.container.get<GitPromptServer>(GitPromptServer);
            server.setClient(client);
            client.onDidCloseConnection(() => server.dispose());
            return server;
        })
    ).inSingletonScope();
});
