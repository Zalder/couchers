import { ListItem, ListItemAvatar, ListItemText } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import Alert from "components/Alert";
import Autocomplete from "components/Autocomplete";
import Avatar from "components/Avatar";
import Button from "components/Button";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "components/Dialog";
import { AddIcon } from "components/Icons";
import TextField from "components/TextField";
import useFriendList from "features/connections/friends/useFriendList";
import {
  COULDNT_FIND_ANY_FRIENDS,
  CREATE,
  ERROR_USER_LOAD,
  FRIENDS,
  NEW_CHAT,
  NEW_GROUP_CHAT,
  TITLE,
} from "features/messages/constants";
import { groupChatsListKey } from "features/queryKeys";
import useUserByUsername from "features/userQueries/useUserByUsername";
import { RpcError } from "grpc-web";
import { useRouter } from "next/router";
import { User } from "proto/api_pb";
import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "react-query";
import { service } from "service";
import stringOrFirstString from "utils/stringOrFirstString";

const useStyles = makeStyles((theme) => ({
  field: {
    marginTop: theme.spacing(1),
    "& .MuiInputBase-root": {
      width: "100%",
    },
  },
}));

interface CreateGroupChatFormData {
  title: string;
  users: User.AsObject[];
}

export default function CreateGroupChat({ className }: { className?: string }) {
  const classes = useStyles();

  //handle redirects which want to create a new message with someone
  const router = useRouter();
  const createMessageToUsername = stringOrFirstString(router.query.to);
  const [isOpen, setIsOpen] = useState(!!createMessageToUsername);
  const createMessageToUserQuery = useUserByUsername(
    createMessageToUsername ?? ""
  );

  const friends = useFriendList();
  const {
    control,
    register,
    handleSubmit,
    reset: resetForm,
  } = useForm<CreateGroupChatFormData>();

  const queryClient = useQueryClient();
  const {
    mutate: createGroupChat,
    isLoading: isCreateLoading,
    error: createError,
    reset: resetMutationStatus,
  } = useMutation<number, RpcError, CreateGroupChatFormData>(
    ({ title, users }) => service.conversations.createGroupChat(title, users),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(groupChatsListKey);
        resetForm();
        setIsOpen(false);
      },
    }
  );

  const onSubmit = handleSubmit(({ title, users }: CreateGroupChatFormData) =>
    createGroupChat({ title, users })
  );

  const handleClose = () => {
    setIsOpen(false);
    resetMutationStatus();
  };

  const errors = [...friends.errors];
  if (createError) errors.push(createError.message);

  const [isGroup, setIsGroup] = useState(false);

  return (
    <>
      <ListItem button onClick={() => setIsOpen(true)} className={className}>
        <ListItemAvatar>
          <Avatar>
            <AddIcon />
          </Avatar>
        </ListItemAvatar>
        <ListItemText>{NEW_CHAT}</ListItemText>
      </ListItem>
      <Dialog
        aria-labelledby="create-dialog-title"
        open={isOpen}
        onClose={handleClose}
        keepMounted={
          //prevents the form state being lost
          true
        }
      >
        <form onSubmit={onSubmit}>
          <DialogTitle id="create-dialog-title">
            {isGroup ? NEW_GROUP_CHAT : NEW_CHAT}
          </DialogTitle>
          <DialogContent>
            {!!errors.length && (
              <Alert severity={"error"}>{errors.join("\n")}</Alert>
            )}
            {isGroup && (
              <TextField
                id="group-chat-title"
                label={TITLE}
                name="title"
                inputRef={register}
                className={classes.field}
              />
            )}
            {createMessageToUserQuery.error && (
              <Alert severity="error">{createMessageToUserQuery.error}</Alert>
            )}
            {
              // need to mount the autocomplete with the correct default value
              // of the "to" user, display a dummy loader until then
              !createMessageToUserQuery.isLoading ? (
                <Controller
                  control={control}
                  name="users"
                  defaultValue={
                    createMessageToUserQuery.data
                      ? [createMessageToUserQuery.data]
                      : []
                  }
                  render={({ onChange, value }) => {
                    return (
                      <Autocomplete
                        id="users-autocomplete"
                        onChange={(_, newValue) => {
                          onChange(newValue);
                          setIsGroup((newValue?.length ?? 0) > 1);
                        }}
                        multiple={true}
                        loading={friends.isLoading}
                        options={friends.data ?? []}
                        noOptionsText={COULDNT_FIND_ANY_FRIENDS}
                        getOptionLabel={(friend) => {
                          return friend?.name ?? ERROR_USER_LOAD;
                        }}
                        label={FRIENDS}
                        className={classes.field}
                        value={value ?? []}
                      />
                    );
                  }}
                />
              ) : (
                <Autocomplete
                  id="loading-users-autocomplete"
                  loading
                  multiple
                  options={[]}
                  label={FRIENDS}
                  value={[]}
                />
              )
            }
          </DialogContent>
          <DialogActions>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              onClick={onSubmit}
              loading={isCreateLoading}
            >
              {CREATE}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}