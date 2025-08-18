import DeleteIcon from "../icons/delete.svg";

import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";

import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path, ServiceProvider } from "../constant";
import { MaskAvatar } from "./mask";
import { Mask } from "../store/mask";
import { useRef, useEffect } from "react";
import { showConfirm } from "./ui-lib";
import { useMobileScreen } from "../utils";
import { nanoid } from "nanoid";
import clsx from "clsx";
import { useAppConfig } from "../store/config";

export function ChatItem(props: {
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  count: number;
  time: string;
  selected: boolean;
  id: string;
  index: number;
  narrow?: boolean;
  mask: Mask;
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current?.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected]);

  const { pathname: currentPath } = useLocation();
  return (
    <Draggable draggableId={`${props.id}`} index={props.index}>
      {(provided) => (
        <div
          className={clsx(styles["chat-item"], {
            [styles["chat-item-selected"]]:
              props.selected &&
              (currentPath === Path.Chat || currentPath === Path.Home),
          })}
          onClick={props.onClick}
          ref={(ele) => {
            draggableRef.current = ele;
            provided.innerRef(ele);
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          title={`${props.title}\n${Locale.ChatItem.ChatItemCount(
            props.count,
          )}`}
        >
          {props.narrow ? (
            <div className={styles["chat-item-narrow"]}>
              <div className={clsx(styles["chat-item-avatar"], "no-dark")}>
                <MaskAvatar
                  avatar={props.mask.avatar}
                  model={props.mask.modelConfig.model}
                />
              </div>
              <div className={styles["chat-item-narrow-count"]}>
                {props.count}
              </div>
            </div>
          ) : (
            <>
              <div className={styles["chat-item-title"]}>{props.title}</div>
              <div className={styles["chat-item-info"]}>
                <div className={styles["chat-item-count"]}>
                  {Locale.ChatItem.ChatItemCount(props.count)}
                </div>
                <div className={styles["chat-item-date"]}>{props.time}</div>
              </div>
            </>
          )}

          <div
            className={styles["chat-item-delete"]}
            onClickCapture={(e) => {
              props.onDelete?.();
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteIcon />
          </div>
        </div>
      )}
    </Draggable>
  );
}

export function ChatList(props: { narrow?: boolean }) {
  const [sessions, selectedIndex, selectSession, moveSession] = useChatStore(
    (state) => [
      state.sessions,
      state.currentSessionIndex,
      state.selectSession,
      state.moveSession,
    ],
  );
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    moveSession(source.index, destination.index);
  };

  let count = 0;

  window.parent.postMessage({
    chat_done: true
  }, '*');

  window.onmessage = (event) => {
    console.log('list onmessage ', event);
    if (event.data.isChatList && count === 0) {
      // let isHaveTitleChat = false; // 是否存在指定标题的聊天
      // let chatIndex = 0;

      // sessions.forEach((item, index) => {
      //   if (item.topic === event.data.name) {
      //     isHaveTitleChat = true;
      //     chatIndex = index;
      //   }
      // })

      // // 没有，就去新建一个聊天
      // if (!isHaveTitleChat) {
        
      // } else {
      //   navigate(Path.Chat);
      //   selectSession(chatIndex);
      // }

      navigate(Path.NewChat);

      const startChat = (mask?: Mask) => {
        setTimeout(() => {
          chatStore.newSession(mask);
          navigate(Path.Chat);
        }, 10);
      };

      startChat({
        id: nanoid(),
        avatar: "1f638",
        name: event.data.name,
        modelType: 'MCN',
        context: [
          {
            id: "is_hidden_msg",
            role: "user",
            content: event.data.prompt,
            date: "",
          },
          {
            id: "is_hidden_msg",
            role: "assistant",
            content: event.data.desc,
            date: "",
          },
          {
            id: "pain-1",
            role: "assistant",
            content: '我是你的 AI 助手。关于这个文件，有什么问题都可以问我！',
            date: "",
          }
        ],
        modelConfig: {
          model: "gemini-2.5-flash",
          providerName: ServiceProvider.Google,
          temperature: 1,
          max_tokens: 2000,
          presence_penalty: 0,
          frequency_penalty: 0,
          sendMemory: true,
          historyMessageCount: 4,
          compressMessageLengthThreshold: 1000,
          top_p: useAppConfig.getState().modelConfig.top_p,
          compressModel: useAppConfig.getState().modelConfig.compressModel,
          compressProviderName: useAppConfig.getState().modelConfig.compressProviderName,
          enableInjectSystemPrompts: useAppConfig.getState().modelConfig.enableInjectSystemPrompts,
          template: useAppConfig.getState().modelConfig.template,
          size: useAppConfig.getState().modelConfig.size,
          quality: useAppConfig.getState().modelConfig.quality,
          style: useAppConfig.getState().modelConfig.style,
        },
        lang: "cn",
        builtin: true,
        createdAt: 1688899480537,
      });
    }

    count = 1;
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="chat-list">
        {(provided) => (
          <div
            className={styles["chat-list"]}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {sessions.map((item, i) => (
              <ChatItem
                title={item.topic}
                time={new Date(item.lastUpdate).toLocaleString()}
                count={item.messages.length}
                key={item.id}
                id={item.id}
                index={i}
                selected={i === selectedIndex}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(i);
                }}
                onDelete={async () => {
                  if (
                    (!props.narrow && !isMobileScreen) ||
                    (await showConfirm(Locale.Home.DeleteChat))
                  ) {
                    chatStore.deleteSession(i);
                  }
                }}
                narrow={props.narrow}
                mask={item.mask}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
