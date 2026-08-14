import { createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net, shell } from 'electron'
import type { UpdateInfo, UpdateProgress } from '../shared/types'
import {
  compararVersoes,
  escolherAsset,
  normalizarVersao,
  type AssetGitHub
} from './update-logic'

const REPOSITORIO = 'lucas3322/vela-studio'
const API = `https://api.github.com/repos/${REPOSITORIO}/releases/latest`

/**
 * Atualização pelo próprio app.
 *
 * Checa a última release do GitHub, escolhe o instalador certo para esta
 * plataforma, baixa com progresso e abre o arquivo. O passo final ainda é
 * humano — arrastar para a pasta Aplicativos no macOS, seguir o instalador no
 * Windows.
 *
 * Por que não substituir o app sozinho: o Squirrel.Mac (que é o que o
 * `electron-updater` usa) exige que o app instalado e a atualização tenham a
 * mesma assinatura de Developer ID. O Vela é assinado ad-hoc, então a troca
 * automática falharia na validação — e falharia *depois* de baixar, deixando o
 * usuário sem app e sem explicação. Enquanto não houver certificado, baixar e
 * abrir o instalador é o mais longe que dá para ir sem prometer o que não
 * cumprimos.
 */

/** Última checagem bem-sucedida. O download lê daqui em vez de aceitar URL do renderer. */
let ultimaChecagem: UpdateInfo | null = null

export async function verificarAtualizacao(): Promise<UpdateInfo> {
  const versaoAtual = app.getVersion()

  try {
    const resposta = await net.fetch(API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `VelaStudio/${versaoAtual}`
      }
    })

    if (resposta.status === 404) {
      return {
        status: 'erro',
        versaoAtual,
        mensagem: 'O repositório ainda não tem nenhuma versão publicada.'
      }
    }
    if (resposta.status === 403) {
      // A API pública do GitHub limita por IP. Não é erro do usuário.
      return {
        status: 'erro',
        versaoAtual,
        mensagem: 'O GitHub limitou as consultas por agora. Tente de novo daqui a pouco.'
      }
    }
    if (!resposta.ok) {
      return {
        status: 'erro',
        versaoAtual,
        mensagem: `Não consegui consultar as versões (HTTP ${resposta.status}).`
      }
    }

    const release = (await resposta.json()) as {
      tag_name?: string
      name?: string
      body?: string
      published_at?: string
      html_url?: string
      assets?: AssetGitHub[]
    }

    const versaoNova = normalizarVersao(release.tag_name ?? release.name ?? '')
    if (!versaoNova) {
      return { status: 'erro', versaoAtual, mensagem: 'A última release não tem número de versão.' }
    }

    if (compararVersoes(versaoNova, versaoAtual) <= 0) {
      const info: UpdateInfo = { status: 'atual', versaoAtual, versaoNova }
      ultimaChecagem = info
      return info
    }

    const base = {
      versaoAtual,
      versaoNova,
      notas: release.body?.trim() || undefined,
      publicadoEm: release.published_at,
      paginaUrl: release.html_url
    }

    const asset = escolherAsset(release.assets ?? [], process.platform, process.arch)
    const info: UpdateInfo = asset
      ? {
          ...base,
          status: 'disponivel',
          downloadUrl: asset.browser_download_url,
          nomeArquivo: asset.name,
          tamanhoBytes: asset.size
        }
      : {
          ...base,
          status: 'sem-arquivo',
          mensagem: `A versão ${versaoNova} não publicou instalador para ${descreverPlataforma()}.`
        }

    ultimaChecagem = info
    return info
  } catch (error) {
    return {
      status: 'erro',
      versaoAtual,
      mensagem: `Não consegui falar com o GitHub: ${(error as Error).message}`
    }
  }
}

function descreverPlataforma(): string {
  const sistema =
    process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  return `${sistema} ${process.arch}`
}

/**
 * Baixa o instalador da última checagem e devolve o caminho no disco.
 *
 * A URL vem do que o main guardou, nunca do renderer — assim uma falha na UI
 * não vira "baixe e abra este arquivo daqui".
 *
 * O arquivo é escrito com sufixo `.parcial` e só renomeado no fim. Um download
 * interrompido não pode deixar para trás um DMG truncado com o nome definitivo,
 * que abriria como imagem corrompida sem ninguém entender por quê.
 */
export async function baixarAtualizacao(
  aoProgredir: (progresso: UpdateProgress) => void
): Promise<string> {
  const info = ultimaChecagem
  if (!info || info.status !== 'disponivel' || !info.downloadUrl || !info.nomeArquivo) {
    throw new Error('Nenhuma atualização pronta para baixar. Verifique novamente.')
  }

  const destino = join(app.getPath('downloads'), info.nomeArquivo)
  const parcial = `${destino}.parcial`

  const resposta = await net.fetch(info.downloadUrl)
  if (!resposta.ok || !resposta.body) {
    throw new Error(`O download falhou (HTTP ${resposta.status}).`)
  }

  const totalBytes = Number(resposta.headers.get('content-length')) || info.tamanhoBytes || 0
  let recebidoBytes = 0
  let ultimoAviso = 0

  await rm(parcial, { force: true })
  await pipeline(
    Readable.fromWeb(resposta.body as Parameters<typeof Readable.fromWeb>[0]),
    async function* (fonte) {
      for await (const pedaco of fonte) {
        recebidoBytes += (pedaco as Buffer).length
        // Um evento por chunk inundaria o IPC e engasgaria a UI.
        const agora = Date.now()
        if (agora - ultimoAviso > 150) {
          ultimoAviso = agora
          aoProgredir({ recebidoBytes, totalBytes })
        }
        yield pedaco
      }
    },
    createWriteStream(parcial)
  )

  // Tamanho diferente do anunciado significa download truncado ou uma página de
  // erro salva no lugar do instalador. Abrir isso confunde muito mais do que falhar.
  if (info.tamanhoBytes) {
    const { size } = await stat(parcial)
    if (size !== info.tamanhoBytes) {
      await rm(parcial, { force: true })
      throw new Error('O download chegou incompleto. Tente de novo ou baixe pela página da release.')
    }
  }

  await rm(destino, { force: true })
  await rename(parcial, destino)
  aoProgredir({ recebidoBytes: totalBytes || recebidoBytes, totalBytes })
  return destino
}

/**
 * Encerra o app depois de abrir o instalador — só no macOS.
 *
 * No macOS a instalação é arrastar o app novo para Aplicativos, e o Finder
 * **recusa** substituir um app que está rodando: "o item está em uso". A pessoa
 * precisava descobrir sozinha que faltava fechar a IDE, voltar ao DMG e
 * arrastar de novo. Fechar aqui tira esse passo invisível do caminho.
 *
 * O atraso existe para o DMG terminar de montar e aparecer na tela antes de a
 * janela sumir; fechar antes disso faria a IDE simplesmente desaparecer, o que
 * lê como travamento em vez de "agora arraste".
 *
 * No Windows e no Linux o instalador cuida da substituição sozinho, então
 * fechar seria atrapalhar.
 */
function encerrarParaTrocarNoMac(): void {
  if (process.platform !== 'darwin') return
  setTimeout(() => app.quit(), 1500)
}

/** Abre o instalador baixado (monta o DMG, roda o setup). */
export async function abrirArquivo(caminho: string): Promise<void> {
  const erro = await shell.openPath(caminho)
  if (erro) {
    shell.showItemInFolder(caminho)
    throw new Error(`Não consegui abrir o instalador: ${erro}`)
  }

  encerrarParaTrocarNoMac()
}

export async function abrirPaginaDaRelease(): Promise<void> {
  await shell.openExternal(ultimaChecagem?.paginaUrl ?? `https://github.com/${REPOSITORIO}/releases/latest`)
}
